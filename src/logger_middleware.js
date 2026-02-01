/**
 * @file src/logger_middleware.js
 * @description Core webhook logging middleware. Handles request validation, payload processing,
 * signature verification, large payload offloading to KVS, and response generation.
 */
import { Actor } from "apify";
import Ajv from "ajv";
import { nanoid } from "nanoid";
import vm from "vm";
import { validateAuth } from "./utils/auth.js";
import { getSafeResponseDelay, parseWebhookOptions } from "./utils/config.js";
import { checkIpInRanges } from "./utils/ssrf.js";
import {
  generateKvsKey,
  offloadToKvs,
  getKvsUrl,
  createReferenceBody,
  OFFLOAD_MARKER_STREAM,
  OFFLOAD_MARKER_SYNC,
} from "./utils/storage_helper.js";
import {
  BACKGROUND_TASK_TIMEOUT_PROD_MS,
  BACKGROUND_TASK_TIMEOUT_TEST_MS,
  SCRIPT_EXECUTION_TIMEOUT_MS,
  SENSITIVE_HEADERS,
  DEFAULT_PAYLOAD_LIMIT,
  KVS_OFFLOAD_THRESHOLD,
} from "./consts.js";
import {
  createStreamVerifier,
  verifySignature,
  finalizeStreamVerification,
} from "./utils/signature.js";
import { triggerAlertIfNeeded } from "./utils/alerting.js";
import { appEvents, EVENTS } from "./utils/events.js";
import { ForwardingService } from "./services/ForwardingService.js";
import { PassThrough } from "stream";
import { webhookRateLimiter } from "./utils/webhook_rate_limiter.js";
import {
  createChildLogger,
  serializeError as serializeErrorUtil,
} from "./utils/logger.js";

/**
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("ajv").default} AjvType
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("ajv").ValidateFunction | null} ValidateFunction
 * @typedef {import("http").IncomingHttpHeaders} IncomingHttpHeaders
 * @typedef {import('pino').Logger} Logger
 * @typedef {import("./webhook_manager.js").WebhookManager} WebhookManager
 * @typedef {import("./typedefs.js").WebhookEvent} WebhookEvent
 * @typedef {import('./typedefs.js').LoggerOptions} LoggerOptions
 * @typedef {import('./typedefs.js').CommonError} CommonError
 * @typedef {import('./typedefs.js').MiddlewareValidationResult} MiddlewareValidationResult
 */

/** @type {AjvType} */
// Force cast to handle ESM/CommonJS interop usually found with ajv
const ajv = new Ajv.default();

export class LoggerMiddleware {
  #webhookManager;
  #onEvent;
  #options;
  #forwardingService;
  /** @type {vm.Script | null} */
  #compiledScript = null;
  /** @type {ValidateFunction} */
  #validate = null;
  /** @type {Logger} */
  #log;
  /** @type {typeof serializeErrorUtil} */
  #serializeError;

  /**
   * Validates and coerces a forced status code.
   * @param {any} forcedStatus
   * @param {number} [defaultCode=200]
   * @returns {number}
   */
  static getValidStatusCode(forcedStatus, defaultCode = 200) {
    const forced = Number(forcedStatus);
    if (Number.isFinite(forced) && forced >= 100 && forced < 600) {
      return forced;
    }
    return defaultCode;
  }

  /**
   * @param {WebhookManager} webhookManager
   * @param {Object} rawOptions
   * @param {Function} onEvent
   * @param {ForwardingService} [forwardingService] - Dependency injection for testing
   */
  constructor(webhookManager, rawOptions, onEvent, forwardingService) {
    this.#webhookManager = webhookManager;
    this.#onEvent = onEvent;

    // Initialize private logger FIRST (required by #refreshCompilations)
    this.#log = createChildLogger({ component: "LoggerMiddleware" });
    this.#serializeError = serializeErrorUtil;

    // Bind methods where necessary (middleware is used as value)
    this.middleware = this.middleware.bind(this);
    this.ingestMiddleware = this.ingestMiddleware.bind(this);
    /** @type {any} */ (this.middleware).updateOptions =
      this.updateOptions.bind(this);

    // Initial compilation (uses #log internally)
    const options = parseWebhookOptions(rawOptions);
    this.#refreshCompilations(options);
    /** @type {LoggerOptions} */
    this.#options = options;

    /** @type {ForwardingService} */
    this.#forwardingService = forwardingService || new ForwardingService();
  }

  /**
   * Expose options getter for testing or read-only access
   * @returns {LoggerOptions}
   */
  get options() {
    return this.#options;
  }

  /**
   * Expose compiled script availability for testing or read-only access
   * @returns {boolean}
   */
  hasCompiledScript() {
    return this.#compiledScript !== null;
  }

  /**
   * Expose validator availability for testing or read-only access
   * @returns {boolean}
   */
  hasValidator() {
    return this.#validate !== null;
  }

  /**
   * @param {Object} newRawOptions
   */
  updateOptions(newRawOptions) {
    const newOptions = parseWebhookOptions(newRawOptions);
    this.#refreshCompilations(newOptions);
    this.#options = newOptions; // Switch to new options
  }

  /**
   * Generic helper to compile resources (scripts, schemas) safely
   * @template T
   * @param {string | object | undefined} source
   * @param {(src: any) => T} compilerFn
   * @param {string} successMsg
   * @param {string} errorPrefix
   * @returns {T | null}
   */
  #compileResource(source, compilerFn, successMsg, errorPrefix) {
    if (!source) return null;
    try {
      const result = compilerFn(source);
      this.#log.info(successMsg);
      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");
      this.#log.error({ errorPrefix, message }, "Invalid resource");
      return null;
    }
  }

  /**
   * @param {LoggerOptions} newOptions
   */
  #refreshCompilations(newOptions) {
    const currentOptions = this.#options;

    // 1. Smart script re-compilation
    if (
      !currentOptions ||
      newOptions.customScript !== currentOptions.customScript
    ) {
      this.#compiledScript = this.#compileResource(
        newOptions.customScript,
        (src) => new vm.Script(src),
        "Custom script re-compiled successfully.",
        "SCRIPT-ERROR",
      );
    }

    // 2. Smart schema re-compilation
    const oldSchemaStr =
      currentOptions && typeof currentOptions.jsonSchema === "object"
        ? JSON.stringify(currentOptions.jsonSchema)
        : currentOptions?.jsonSchema;
    const newSchemaStr =
      typeof newOptions.jsonSchema === "object"
        ? JSON.stringify(newOptions.jsonSchema)
        : newOptions.jsonSchema;

    if (!currentOptions || newSchemaStr !== oldSchemaStr) {
      this.#validate = this.#compileResource(
        newOptions.jsonSchema,
        (src) => {
          const schema = typeof src === "string" ? JSON.parse(src) : src;
          return ajv.compile(schema);
        },
        "JSON Schema re-compiled successfully.",
        "SCHEMA-ERROR",
      );
    }
  }

  /**
   * Helper to resolve options for a request, merging global defaults with webhook-specific overrides.
   * @param {string} webhookId
   * @returns {LoggerOptions}
   */
  #resolveOptions(webhookId) {
    const webhookData = this.#webhookManager.getWebhookData(webhookId) || {};

    // Only allow non-security settings to be overridden per-webhook
    const allowedOverrides = [
      "defaultResponseCode",
      "defaultResponseBody",
      "defaultResponseHeaders",
      "responseDelayMs",
    ];
    const webhookOverrides = Object.fromEntries(
      Object.entries(webhookData).filter(([key]) =>
        allowedOverrides.includes(key),
      ),
    );

    return {
      ...this.#options,
      ...webhookOverrides,
    };
  }

  /**
   * Ingest Middleware: Runs BEFORE body-parser.
   * Handles GB-scale payloads by streaming them directly to KVS.
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  async ingestMiddleware(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD") return next();

    const webhookId = String(req.params.id);
    const clientIp = req.ip || req.socket?.remoteAddress;

    // Per-webhook rate limiting (DDoS protection)
    const rateLimitResult = webhookRateLimiter.check(webhookId, clientIp);
    if (!rateLimitResult.allowed) {
      res.setHeader("Retry-After", Math.ceil(rateLimitResult.resetMs / 1000));
      res.setHeader("X-RateLimit-Limit", webhookRateLimiter.limit);
      res.setHeader("X-RateLimit-Remaining", rateLimitResult.remaining);

      return res.status(429).json({
        status: 429,
        error: "Too Many Requests",
        message: `Webhook rate limit exceeded. Max ${webhookRateLimiter.limit} requests per minute per webhook.`,
        retryAfterSeconds: Math.ceil(rateLimitResult.resetMs / 1000),
      });
    }

    const options = this.#resolveOptions(webhookId);

    // Check Content-Length to decide strategy
    const rawHeader = req.headers["content-length"];
    const contentLength = rawHeader ? parseInt(String(rawHeader), 10) : 0;

    const maxSize = options.maxPayloadSize ?? DEFAULT_PAYLOAD_LIMIT;

    // 1. Hard Security Limit Check
    if (contentLength > maxSize) {
      return res.status(413).json({
        error: `Payload too large. Limit is ${maxSize} bytes.`,
        received: contentLength,
      });
    }

    // 2. Streaming Offload Check
    // If > threshold, we stream to KVS and bypass body-parser
    if (contentLength > KVS_OFFLOAD_THRESHOLD) {
      const kvsKey = generateKvsKey();
      const rawContentType =
        req.headers["content-type"] || "application/octet-stream";

      this.#log.info(
        { contentLength, kvsKey },
        "Streaming large payload to KVS",
      );

      try {
        // Setup streaming signature verification
        let verifier = null;
        if (
          options.signatureVerification?.provider &&
          options.signatureVerification?.secret
        ) {
          const result = createStreamVerifier(
            options.signatureVerification,
            /** @type {Record<string, string>} */ (req.headers),
          );
          if (result.hmac) {
            verifier = result;
            this.#log.info(
              { provider: options.signatureVerification.provider },
              "Stream signature verification initialized",
            );
          } else {
            this.#log.warn(
              { error: result.error },
              "Failed to init stream verifier",
            );
          }
        }

        const kvsStream = new PassThrough();

        // Fork stream: One to KVS, one to Verifier (if active)
        req.pipe(kvsStream);
        if (verifier && verifier.hmac) {
          req.on("data", (chunk) => {
            verifier.hmac?.update(chunk);
          });
        }

        // Stream directly to KVS using helper
        // storage helper supports stream as value
        await offloadToKvs(kvsKey, kvsStream, rawContentType);

        // Finalize signature if active
        if (verifier && verifier.hmac) {
          const valid = finalizeStreamVerification(verifier);

          // Attach result to req for the main middleware to use
          /** @type {any} */ (req).ingestSignatureResult = {
            valid,
            provider: options.signatureVerification?.provider,
            error: valid ? undefined : "Signature mismatch (stream verified)",
          };
        }

        const kvsUrl = await getKvsUrl(kvsKey);

        // Construct Reference Body
        const referenceBody = createReferenceBody({
          key: kvsKey,
          kvsUrl,
          originalSize: contentLength,
          note: "Body streamed to KeyValueStore due to size.",
          data: OFFLOAD_MARKER_STREAM,
        });

        // Replace body and flag to bypass body-parser
        req.body = referenceBody;
        /** @type {any} */ (req)._body = true; // Signals body-parser to skip
        /** @type {any} */ (req).isOffloaded = true; // Signal for later middlewares

        return next();
      } catch (err) {
        this.#log.error(
          { err: this.#serializeError(err) },
          "Streaming offload failed",
        );
        return res.status(500).json({
          error: "Failed to process large upload",
          details: /** @type {Error} */ (err).message,
        });
      }
    }

    next();
  }

  /**
   * Main Middleware: Logic for logging, processing, and responding.
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} [_next]
   */
  async middleware(req, res, _next) {
    const startTime = Date.now();
    const webhookId = String(req.params.id);

    // 1. Resolve Options
    const mergedOptions = this.#resolveOptions(webhookId);

    const validation = this.#validateWebhookRequest(
      req,
      webhookId,
      mergedOptions,
    );
    if (!validation.isValid) {
      return res.status(validation.statusCode || 400).json({
        error: validation.error,
        ip: validation.remoteIp,
        received: validation.contentLength,
        id: webhookId,
        docs: "https://apify.com/ar27111994/webhook-debugger-logger",
      });
    }

    try {
      // 2. Prepare
      const isOffloaded = /** @type {any} */ (req).isOffloaded;
      let preparedData;

      if (isOffloaded) {
        // If already offloaded by ingestMiddleware, just use what we have
        preparedData = {
          loggedBody: req.body,
          loggedHeaders: mergedOptions.maskSensitiveData
            ? this.#maskHeaders(req.headers)
            : req.headers,
          contentType:
            req.headers["content-type"]?.split(";")[0].trim().toLowerCase() ||
            "application/octet-stream",
          bodyEncoding: undefined,
        };
      } else {
        // Standard processing for smaller payloads
        preparedData = await this.#prepareRequestData(req, mergedOptions);
      }

      const { loggedBody, loggedHeaders, contentType, bodyEncoding } =
        preparedData;

      // 3. Transform
      /** @type {WebhookEvent} */
      const event = {
        id: nanoid(10),
        timestamp: new Date().toISOString(),
        webhookId,
        method: req.method,
        headers: /** @type {WebhookEvent['headers']} */ (loggedHeaders),
        query: req.query,
        body: loggedBody,
        bodyEncoding,
        contentType,
        size: validation.contentLength,
        statusCode: LoggerMiddleware.getValidStatusCode(
          /** @type {any} */ (req).forcedStatus,
          mergedOptions.defaultResponseCode ?? 200,
        ),
        responseBody: undefined, // Custom scripts can set this
        responseHeaders: {}, // Custom scripts can add headers
        processingTime: 0,
        remoteIp: validation.remoteIp,
        userAgent: req.headers["user-agent"]?.toString(),
        requestId: /** @type {any} */ (req).requestId,
        requestUrl: req.originalUrl || req.url,
      };

      // 3a. Signature Verification (if configured)
      if (
        mergedOptions.signatureVerification?.provider &&
        mergedOptions.signatureVerification?.secret
      ) {
        const ingestResult = /** @type {any} */ (req).ingestSignatureResult;

        if (ingestResult) {
          // Use pre-calculated result from streaming offload
          event.signatureValid = ingestResult.valid;
          event.signatureProvider = ingestResult.provider;
          if (!ingestResult.valid) {
            event.signatureError = ingestResult.error;
          }
        } else {
          // Standard Sync Verification
          // Use preserved rawBody if available (critical for Shopify/Stripe signatures)
          // Fallback to re-stringifying body if necessary (though less reliable)
          const rawBody =
            /** @type {any} */ (req).rawBody ||
            (typeof req.body === "string"
              ? req.body
              : JSON.stringify(req.body));
          const lowercaseHeaders = Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [
              k.toLowerCase(),
              String(v),
            ]),
          );
          const sigResult = verifySignature(
            mergedOptions.signatureVerification,
            rawBody,
            lowercaseHeaders,
          );
          event.signatureValid = sigResult.valid;
          event.signatureProvider = sigResult.provider;
          if (!sigResult.valid) {
            event.signatureError = sigResult.error;
          }
        }
      }

      this.#transformRequestData(event, req);

      // 4. Orchestration: Respond synchronous-ish, then race background tasks
      const delayMs = getSafeResponseDelay(mergedOptions.responseDelayMs);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      event.processingTime = Date.now() - startTime;
      this.#sendResponse(res, event, mergedOptions);

      // Execute background tasks (storage, forwarding, alerting) after response
      const backgroundPromise = async () => {
        try {
          await this.#executeBackgroundTasks(event, req, mergedOptions);

          // Trigger alerts if configured
          if (mergedOptions.alerts) {
            const alertConfig = {
              slack: mergedOptions.alerts.slack,
              discord: mergedOptions.alerts.discord,
              alertOn: mergedOptions.alertOn || ["error", "5xx"],
            };
            const alertContext = {
              webhookId: event.webhookId,
              method: event.method,
              statusCode: event.statusCode,
              signatureValid: event.signatureValid,
              signatureError: event.signatureError,
              timestamp: event.timestamp,
              sourceIp: event.remoteIp,
            };
            await triggerAlertIfNeeded(alertConfig, alertContext);
          }
        } catch (err) {
          this.#log.error(
            { eventId: event.id, err: this.#serializeError(err) },
            "Background tasks failed",
          );
        }
      };

      // Wrap background work in Promise.race to ensure we don't hang the Actor if storage is slow
      const timeoutMs =
        process.env.NODE_ENV === "test"
          ? BACKGROUND_TASK_TIMEOUT_TEST_MS
          : BACKGROUND_TASK_TIMEOUT_PROD_MS;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timeoutHandle;
      await Promise.race([
        backgroundPromise().finally(() => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }),
        /** @type {Promise<void>} */
        (
          new Promise((resolve) => {
            timeoutHandle = setTimeout(() => {
              if (process.env.NODE_ENV !== "test") {
                const readableTimeout =
                  timeoutMs < 1000 ? `${timeoutMs}ms` : `${timeoutMs / 1000}s`;
                this.#log.warn(
                  { eventId: event.id, timeout: readableTimeout },
                  "Background tasks exceeded timeout",
                );
              }
              resolve();
            }, timeoutMs);
            if (timeoutHandle.unref) timeoutHandle.unref();
          })
        ),
      ]);
    } catch (err) {
      const middlewareError = /** @type {CommonError} */ (err);
      if (middlewareError.statusCode) {
        return res.status(middlewareError.statusCode).json({
          error: middlewareError.error,
          details: middlewareError.details,
        });
      }
      this.#log.error(
        { err: this.#serializeError(middlewareError) },
        "Internal middleware error",
      );
      res.status(500).json({ error: "Internal Server Error" });
    }
  }

  /**
   * @param {Request} req
   * @param {string} webhookId
   * @param {LoggerOptions} options
   * @returns {MiddlewareValidationResult}
   */
  #validateWebhookRequest(req, webhookId, options) {
    const authKey = options.authKey || "";
    const allowedIps = options.allowedIps || [];

    // 1. Basic ID Validation
    if (!this.#webhookManager.isValid(webhookId)) {
      return {
        isValid: false,
        statusCode: 404,
        error: "Webhook ID not found or expired",
      };
    }

    // 2. IP Whitelisting
    const remoteIp = req.ip || req.socket.remoteAddress;
    if (allowedIps.length > 0) {
      const isAllowed = checkIpInRanges(remoteIp || "", allowedIps);
      if (!isAllowed) {
        return {
          isValid: false,
          statusCode: 403,
          error: "Forbidden: IP not in whitelist",
          remoteIp,
        };
      }
    }

    // 3. Authentication Check
    const authResult = validateAuth(req, authKey);
    if (!authResult.isValid) {
      return {
        isValid: false,
        statusCode: 401,
        error: authResult.error,
      };
    }

    // 4. Payload size check
    const rawHeader = req.headers["content-length"];
    let parsedLength = NaN;
    if (rawHeader !== undefined) {
      const headerStr = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      parsedLength = Number.parseInt(String(headerStr), 10);
    }

    const bodyLen =
      typeof req.body === "string"
        ? Buffer.byteLength(req.body)
        : Buffer.isBuffer(req.body)
          ? req.body.length
          : req.body && typeof req.body === "object"
            ? Buffer.byteLength(JSON.stringify(req.body))
            : 0;

    const contentLength = Number.isFinite(parsedLength)
      ? parsedLength
      : bodyLen;
    const maxSize = options.maxPayloadSize ?? DEFAULT_PAYLOAD_LIMIT;
    if (contentLength > maxSize) {
      return {
        isValid: false,
        statusCode: 413,
        error: `Payload too large. Limit is ${maxSize} bytes.`,
        remoteIp,
        contentLength,
      };
    }

    return { isValid: true, remoteIp, contentLength, received: contentLength };
  }

  /**
   * @param {Request} req
   * @param {LoggerOptions} options
   * @returns {Promise<{ loggedBody: string|object, loggedHeaders: Object, contentType: string, bodyEncoding?: BufferEncoding }>}
   */
  async #prepareRequestData(req, options) {
    const { maskSensitiveData } = options;
    const rawContentType =
      req.headers["content-type"] || "application/octet-stream";
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();

    // Heuristic for text-based content types
    const isJson = contentType.includes("json");
    const isText =
      contentType.startsWith("text/") ||
      contentType.includes("xml") ||
      contentType.includes("javascript") ||
      contentType.includes("urlencoded") ||
      contentType.includes("html");

    let loggedBody = req.body;
    /** @type {BufferEncoding | undefined} */
    let bodyEncoding;

    // Handle Binary Buffers
    if (Buffer.isBuffer(loggedBody)) {
      if (isJson || isText) {
        loggedBody = loggedBody.toString("utf8");
      } else {
        loggedBody = loggedBody.toString("base64");
        bodyEncoding = "base64";
      }
    }

    // JSON Schema Validation
    if (this.#validate && isJson) {
      let bodyToValidate = loggedBody;
      if (typeof bodyToValidate === "string") {
        try {
          bodyToValidate = JSON.parse(bodyToValidate);
        } catch (_) {
          throw {
            statusCode: 400,
            error: "Invalid JSON for schema validation",
          };
        }
      } else if (Buffer.isBuffer(bodyToValidate)) {
        try {
          bodyToValidate = JSON.parse(bodyToValidate.toString());
        } catch (_) {
          throw { statusCode: 400, error: "Invalid JSON" };
        }
      }

      const isValid = this.#validate(bodyToValidate);
      if (!isValid) {
        throw {
          statusCode: 400,
          error: "JSON Schema Validation Failed",
          details: this.#validate.errors,
        };
      }
    }

    // Parse JSON for storage if enabled and valid
    if (
      isJson &&
      typeof loggedBody === "string" &&
      options.enableJSONParsing !== false
    ) {
      try {
        loggedBody = JSON.parse(loggedBody);
        bodyEncoding = undefined; // Processed to object
      } catch {
        // Keep as string if parsing fails
      }
    }

    // Platform Safety: Offload to KeyValueStore if large to avoid dataset bloat/rejection
    // Apify Dataset limit is ~9MB. But generally, anything >5MB is better in KVS.
    // This logic now applies to both Platform and Self-Hosted/Docker to keep the log listing fast.
    let sizeCheck = 0;
    if (typeof loggedBody === "string")
      sizeCheck = Buffer.byteLength(loggedBody);
    else if (typeof loggedBody === "object")
      sizeCheck = Buffer.byteLength(JSON.stringify(loggedBody));

    if (sizeCheck > KVS_OFFLOAD_THRESHOLD) {
      const kvsKey = generateKvsKey();
      this.#log.info(
        { bodySize: sizeCheck, threshold: KVS_OFFLOAD_THRESHOLD, kvsKey },
        "Body exceeds threshold, offloading to KVS",
      );

      // Determine content to save (prefer original buffer if available, or current state)
      const contentToSave = Buffer.isBuffer(req.body)
        ? req.body
        : typeof loggedBody === "object"
          ? JSON.stringify(loggedBody)
          : loggedBody;

      try {
        await offloadToKvs(kvsKey, contentToSave, rawContentType);

        const kvsUrl = await getKvsUrl(kvsKey);

        // Replace body with reference
        loggedBody = createReferenceBody({
          key: kvsKey,
          kvsUrl,
          originalSize: sizeCheck,
          note: "Body too large for Dataset. Stored in KeyValueStore.",
          data: OFFLOAD_MARKER_SYNC,
        });
        bodyEncoding = undefined; // Reference object is standard JSON
      } catch (err) {
        this.#log.error(
          { err: this.#serializeError(err) },
          "Failed to offload large payload to KVS",
        );
        // Fallback to truncation if KVS fails
        const MAX_FALLBACK_SIZE = 9 * 1024 * 1024; // Hard limit for dataset
        if (typeof loggedBody === "string") {
          loggedBody =
            loggedBody.substring(0, MAX_FALLBACK_SIZE) +
            "\n...[TRUNCATED_AND_KVS_FAILED]";
        } else {
          loggedBody = { error: "Payload too large and KVS offload failed." };
        }
      }
    }

    // Normalize loggedBody for storage (last resort formatting)
    // We prefer stringifying objects to ensure consistent "string" storage in some contexts,
    // though Apify Dataset supports objects. Existing logic enforced stringify for non-empty objects.
    if (
      loggedBody &&
      typeof loggedBody === "object" &&
      Object.keys(loggedBody).length > 0 &&
      !Array.isArray(loggedBody)
    ) {
      loggedBody = JSON.stringify(loggedBody, null, 2);
    } else if (
      !loggedBody ||
      (typeof loggedBody === "object" && Object.keys(loggedBody).length === 0)
    ) {
      loggedBody = "";
    }

    const loggedHeaders = maskSensitiveData
      ? this.#maskHeaders(req.headers)
      : req.headers;

    return { loggedBody, loggedHeaders, contentType, bodyEncoding };
  }

  /**
   * @param {IncomingHttpHeaders} headers
   */
  #maskHeaders(headers) {
    const headersToMask = SENSITIVE_HEADERS;
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        headersToMask.includes(key.toLowerCase()) ? "[MASKED]" : value,
      ]),
    );
  }

  /**
   * @param {WebhookEvent} event
   * @param {Request} req
   */
  #transformRequestData(event, req) {
    if (this.#compiledScript) {
      try {
        const sandbox = { event, req, console };
        this.#compiledScript.runInNewContext(sandbox, {
          timeout: SCRIPT_EXECUTION_TIMEOUT_MS,
        });
      } catch (err) {
        const error = /** @type {CommonError} */ (err);
        const isTimeout =
          error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ||
          error.message?.includes("Script execution timed out");
        this.#log.error(
          {
            webhookId: event.webhookId,
            isTimeout,
            err: this.#serializeError(error),
          },
          isTimeout
            ? `Custom script execution timed out after ${SCRIPT_EXECUTION_TIMEOUT_MS}ms`
            : `Failed to run custom script`,
        );
      }
    }
  }

  /**
   * @param {Response} res
   * @param {WebhookEvent} event
   * @param {LoggerOptions} options
   */
  #sendResponse(res, event, options) {
    const { defaultResponseBody, defaultResponseHeaders } = options;

    // 1. Headers (Global defaults -> Event overrides)
    const headers = {
      ...defaultResponseHeaders,
      ...(event.responseHeaders || {}),
    };
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // 2. Status
    res.status(event.statusCode);

    // 3. Body (Event override -> Global default)
    const responseBody =
      event.responseBody !== undefined
        ? event.responseBody
        : defaultResponseBody;

    if (event.statusCode >= 400 && (!responseBody || responseBody === "OK")) {
      res.json({
        message: `Webhook received with status ${event.statusCode}`,
        webhookId: event.webhookId,
      });
    } else if (typeof responseBody === "object") {
      res.json(responseBody);
    } else {
      res.send(responseBody);
    }
  }

  /**
   * @param {WebhookEvent} event
   * @param {Request} req
   * @param {LoggerOptions} options
   */
  async #executeBackgroundTasks(event, req, options) {
    const { forwardUrl } = options;

    try {
      if (event && event.webhookId) {
        await Actor.pushData(event);
        // Emit internal event for real-time SyncService
        appEvents.emit(EVENTS.LOG_RECEIVED, event);
        if (this.#onEvent) this.#onEvent(event);
      }

      if (forwardUrl) {
        await this.#forwardingService.forwardWebhook(
          event,
          req,
          options,
          forwardUrl,
        );
      }
    } catch (error) {
      const errorMessage = /** @type {Error} */ (error).message;
      const isPlatformError =
        errorMessage &&
        (errorMessage.includes("Dataset") ||
          errorMessage.includes("quota") ||
          errorMessage.includes("limit"));

      this.#log.error(
        {
          webhookId: event.webhookId,
          isPlatformError,
          err: this.#serializeError(error),
        },
        isPlatformError ? "Platform limit error" : "Background error",
      );

      if (isPlatformError) {
        this.#log.warn("Check Apify platform limits or storage availability");
      }
    }
  }
}

/**
 * @typedef {RequestHandler & { updateOptions: Function }} HotReloadableMiddleware
 */

/**
 * Creates the logger middleware instance with hot-reload support.
 * Wraps the class-based implementation for backward compatibility.
 *
 * @param {WebhookManager} webhookManager
 * @param {Object} rawOptions
 * @param {Function} onEvent
 * @returns {HotReloadableMiddleware}
 */
export const createLoggerMiddleware = (webhookManager, rawOptions, onEvent) => {
  const middlewareInstance = new LoggerMiddleware(
    webhookManager,
    rawOptions,
    onEvent,
  );
  return /** @type {HotReloadableMiddleware} */ (middlewareInstance.middleware);
};
