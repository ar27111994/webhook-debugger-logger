/**
 * @file src/logger_middleware.js
 * @description Core webhook logging middleware. Handles request validation, payload processing,
 * signature verification, large payload offloading to KVS, and response generation.
 * @module logger_middleware
 */
import { Actor } from "apify";
import Ajv from "ajv";
import { nanoid } from "nanoid";
import vm from "vm";
import { validateAuth } from "./utils/auth.js";
import { getSafeResponseDelay, parseWebhookOptions } from "./utils/config.js";
import { checkIpInRanges } from "./utils/ssrf.js";
import { sendUnauthorizedResponse } from "./routes/utils.js";
import {
  generateKvsKey,
  offloadToKvs,
  getKvsUrl,
  createReferenceBody,
} from "./utils/storage_helper.js";
import {
  APP_CONSTS,
  ENV_VARS,
  DEFAULT_ID_LENGTH,
  ENV_VALUES,
  STREAM_EVENTS,
} from "./consts/app.js";
import { STORAGE_CONSTS } from "./consts/storage.js";
import {
  HTTP_HEADERS,
  HTTP_STATUS,
  HTTP_METHODS,
  HTTP_STATUS_MESSAGES,
  MIME_TYPES,
  ENCODINGS,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
  RECURSION_HEADER_LOOP_SUFFIX,
  SENSITIVE_HEADERS,
  HTTP_CONSTS,
} from "./consts/http.js";
import { LOG_COMPONENTS, LOG_CONSTS, LOG_TAGS } from "./consts/logging.js";
import {
  ERROR_MESSAGES,
  ERROR_LABELS,
  NODE_ERROR_CODES,
} from "./consts/errors.js";
import {
  createStreamVerifier,
  verifySignature,
  finalizeStreamVerification,
} from "./utils/signature.js";
import { triggerAlertIfNeeded } from "./utils/alerting.js";
import { appEvents, EVENT_NAMES } from "./utils/events.js";
import { forwardingService as defaultForwardingService } from "./services/index.js";
import { PassThrough } from "stream";
import { webhookRateLimiter } from "./utils/webhook_rate_limiter.js";
import {
  createChildLogger,
  serializeError as serializeErrorUtil,
} from "./utils/logger.js";
import { LOG_MESSAGES } from "./consts/messages.js";
import { deepRedact, validateStatusCode } from "./utils/common.js";
import { DEFAULT_ALERT_ON } from "./consts/alerting.js";

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
 * @typedef {import('./typedefs.js').AlertConfig} AlertConfig
 * @typedef {import('./utils/config.js').WebhookConfig} WebhookConfig
 * @typedef {import("./services/index.js").ForwardingService} ForwardingService
 */

/** @type {AjvType} */
// Force cast to handle ESM/CommonJS interop usually found with ajv
const ajv = new Ajv.default();

export class LoggerMiddleware {
  /** @type {WebhookManager} */
  #webhookManager;
  /** @type {Function} */
  #onEvent;
  /** @type {WebhookConfig} */
  #options;
  /** @type {ForwardingService} */
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
   * @param {number} [defaultCode=HTTP_STATUS.OK]
   * @returns {number}
   */
  static getValidStatusCode(forcedStatus, defaultCode = HTTP_STATUS.OK) {
    const forced = Number(forcedStatus);
    if (validateStatusCode(forced)) {
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
    this.#log = createChildLogger({
      component: LOG_COMPONENTS.LOGGER_MIDDLEWARE,
    });
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
    this.#forwardingService = forwardingService || defaultForwardingService;
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
        err instanceof Error
          ? err.message
          : String(err ?? LOG_MESSAGES.UNKNOWN_ERROR);
      this.#log.error({ errorPrefix, message }, LOG_MESSAGES.RESOURCE_INVALID);
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
        LOG_MESSAGES.SCRIPT_COMPILED,
        LOG_TAGS.SCRIPT_ERROR,
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
        LOG_MESSAGES.SCHEMA_COMPILED,
        LOG_TAGS.SCHEMA_ERROR,
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
    /** @type {Array<keyof WebhookConfig>} */
    const allowedOverrides = [
      "defaultResponseCode",
      "defaultResponseBody",
      "defaultResponseHeaders",
      "responseDelayMs",
      "forwardUrl",
      "forwardHeaders",
      "maxForwardRetries",
    ];
    const webhookOverrides = Object.fromEntries(
      Object.entries(webhookData).filter(([key]) =>
        allowedOverrides.includes(/** @type {keyof WebhookConfig} */ (key)),
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
    if (req.method === HTTP_METHODS.GET || req.method === HTTP_METHODS.HEAD)
      return next();

    const webhookId = String(req.params.id);
    const clientIp = req.ip || req.socket?.remoteAddress;

    // 0. Recursion Protection (Loop Detection)
    // If we receive a request that We ourselves forwarded, block it to prevent infinite loops.
    // We check if the incoming header matches THIS specific instance's Run ID.
    const forwardedBy =
      req.headers[RECURSION_HEADER_NAME] ||
      req.headers[HTTP_HEADERS.X_FORWARDED_FOR];
    if (
      forwardedBy === RECURSION_HEADER_VALUE ||
      forwardedBy === `${RECURSION_HEADER_VALUE}${RECURSION_HEADER_LOOP_SUFFIX}`
    ) {
      this.#log.warn(
        { webhookId, clientIp, headers: req.headers },
        ERROR_MESSAGES.RECURSIVE_FORWARDING_BLOCKED,
      );
      return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
        status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.UNPROCESSABLE_ENTITY],
        message: ERROR_MESSAGES.RECURSIVE_FORWARDING,
      });
    }

    // Per-webhook rate limiting (DDoS protection)
    const rateLimitResult = webhookRateLimiter.check(webhookId, clientIp);
    if (!rateLimitResult.allowed) {
      res.setHeader(
        HTTP_HEADERS.RETRY_AFTER,
        Math.ceil(rateLimitResult.resetMs / APP_CONSTS.MS_PER_SECOND),
      );
      res.setHeader(HTTP_HEADERS.X_RATELIMIT_LIMIT, webhookRateLimiter.limit);
      res.setHeader(
        HTTP_HEADERS.X_RATELIMIT_REMAINING,
        rateLimitResult.remaining,
      );

      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        status: HTTP_STATUS.TOO_MANY_REQUESTS,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.TOO_MANY_REQUESTS],
        message: ERROR_MESSAGES.WEBHOOK_RATE_LIMIT_EXCEEDED(
          webhookRateLimiter.limit,
        ),
        retryAfterSeconds: Math.ceil(
          rateLimitResult.resetMs / APP_CONSTS.MS_PER_SECOND,
        ),
      });
    }

    const options = this.#resolveOptions(webhookId);

    // Check Content-Length to decide strategy
    const rawHeader = req.headers[HTTP_HEADERS.CONTENT_LENGTH];
    const contentLength = rawHeader ? parseInt(String(rawHeader), 10) : 0;

    const maxSize = options.maxPayloadSize ?? APP_CONSTS.DEFAULT_PAYLOAD_LIMIT;

    // 1. Hard Security Limit Check
    if (contentLength > maxSize) {
      return res.status(HTTP_STATUS.PAYLOAD_TOO_LARGE).json({
        error: ERROR_MESSAGES.PAYLOAD_TOO_LARGE(maxSize),
        received: contentLength,
      });
    }

    // 2. Streaming Offload Check
    // If > threshold, we stream to KVS and bypass body-parser
    if (contentLength > STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD) {
      const kvsKey = generateKvsKey();
      const rawContentType =
        req.headers[HTTP_HEADERS.CONTENT_TYPE] || MIME_TYPES.OCTET_STREAM;

      this.#log.info({ contentLength, kvsKey }, LOG_MESSAGES.KVS_OFFLOAD_START);

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
              LOG_MESSAGES.STREAM_VERIFIER_INIT,
            );
          } else {
            this.#log.warn(
              { error: result.error },
              LOG_MESSAGES.STREAM_VERIFIER_FAILED,
            );
          }
        }

        const kvsStream = new PassThrough();

        // Fork stream: One to KVS, one to Verifier (if active)
        req.pipe(kvsStream);
        if (verifier && verifier.hmac) {
          req.on(STREAM_EVENTS.DATA, (chunk) => {
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
            error: valid ? undefined : ERROR_LABELS.SIGNATURE_MISMATCH_STREAM,
          };
        }

        const kvsUrl = await getKvsUrl(kvsKey);

        // Construct Reference Body
        const referenceBody = createReferenceBody({
          key: kvsKey,
          kvsUrl,
          originalSize: contentLength,
          note: STORAGE_CONSTS.DEFAULT_OFFLOAD_NOTE,
          data: STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
        });

        // Replace body and flag to bypass body-parser
        req.body = referenceBody;
        /** @type {any} */ (req)._body = true; // Signals body-parser to skip
        /** @type {any} */ (req).isOffloaded = true; // Signal for later middlewares

        return next();
      } catch (err) {
        this.#log.error(
          { err: this.#serializeError(err) },
          LOG_MESSAGES.STREAM_OFFLOAD_FAILED,
        );
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: ERROR_MESSAGES.PAYLOAD_STREAM_FAILED,
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
   * @param {NextFunction} next
   */
  async middleware(req, res, next) {
    const startTime = Date.now();
    const webhookId = String(req.params.id);

    // 1. Resolve Options
    try {
      const mergedOptions = this.#resolveOptions(webhookId);

      const validation = this.#validateWebhookRequest(
        req,
        webhookId,
        mergedOptions,
      );
      if (!validation.isValid) {
        if (validation.statusCode === HTTP_STATUS.UNAUTHORIZED) {
          return sendUnauthorizedResponse(req, res, {
            error: validation.error,
            id: webhookId,
          });
        }
        return res
          .status(validation.statusCode || HTTP_STATUS.BAD_REQUEST)
          .json({
            error: validation.error,
            ip: validation.remoteIp,
            received: validation.contentLength,
            id: webhookId,
            docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
          });
      }

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
            req.headers[HTTP_HEADERS.CONTENT_TYPE]
              ?.split(";")[0]
              .trim()
              .toLowerCase() || MIME_TYPES.OCTET_STREAM,
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
        id: nanoid(DEFAULT_ID_LENGTH),
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
          mergedOptions.defaultResponseCode ?? HTTP_STATUS.OK,
        ),
        responseBody: undefined, // Custom scripts can set this
        responseHeaders: {}, // Custom scripts can add headers
        processingTime: 0,
        remoteIp: validation.remoteIp,
        userAgent: req.headers[HTTP_HEADERS.USER_AGENT]?.toString(),
        requestId: /** @type {any} */ (req).requestId,
        requestUrl: req.originalUrl || req.url,
      };

      // 3a. Signature Verification (if configured)
      if (
        mergedOptions.signatureVerification &&
        mergedOptions.signatureVerification?.provider &&
        mergedOptions.signatureVerification?.secret
      ) {
        const ingestResult = /** @type {any} */ (req).ingestSignatureResult;

        if (ingestResult) {
          // Use pre-validated result if available (from raw-body parser)
          // Use pre-calculated result from streaming offload
          event.signatureValid = ingestResult.valid;
          event.signatureProvider = ingestResult.provider;
          if (!ingestResult.valid) {
            event.signatureError = ingestResult.error;
            event.statusCode = HTTP_STATUS.UNAUTHORIZED;
            event.responseBody = {
              error: ERROR_LABELS.INVALID_SIGNATURE,
              details: ingestResult.error,
              provider: ingestResult.provider,
              docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
            };
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
            event.statusCode = HTTP_STATUS.UNAUTHORIZED;
            // Set delayed response body for #sendResponse to use
            event.responseBody = {
              error: ERROR_LABELS.INVALID_SIGNATURE,
              details: sigResult.error,
              docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
            };
            // Do NOT return here; let it proceed to logging
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
      const controller = new AbortController();
      const backgroundPromise = async () => {
        try {
          await this.#executeBackgroundTasks(
            event,
            req,
            mergedOptions,
            controller.signal,
          );

          // Trigger alerts if configured
          if (mergedOptions.alerts) {
            /** @type {Readonly<AlertConfig['alertOn']>} */
            const alertOn = mergedOptions.alertOn || DEFAULT_ALERT_ON;
            /** @type {AlertConfig} */
            const alertConfig = {
              slack: mergedOptions.alerts.slack,
              discord: mergedOptions.alerts.discord,
              alertOn,
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
          if (!controller.signal.aborted) {
            this.#log.error(
              { eventId: event.id, err: this.#serializeError(err) },
              LOG_MESSAGES.BACKGROUND_TASKS_FAILED,
            );
          }
        }
      };

      // Wrap background work in Promise.race to ensure we don't hang the Actor if storage is slow
      const timeoutMs =
        process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST
          ? APP_CONSTS.BACKGROUND_TASK_TIMEOUT_TEST_MS
          : APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS;
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
              controller.abort(); // Cancel any pending axios requests
              if (process.env[ENV_VARS.NODE_ENV] !== ENV_VALUES.TEST) {
                const readableTimeout =
                  timeoutMs < APP_CONSTS.MS_PER_SECOND
                    ? `${timeoutMs}ms`
                    : `${timeoutMs / APP_CONSTS.MS_PER_SECOND}s`;
                this.#log.warn(
                  { eventId: event.id, timeout: readableTimeout },
                  LOG_MESSAGES.BACKGROUND_TIMEOUT,
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

      if (!res.headersSent) {
        return next(err);
      }
      // If headers are sent, we can't do much but log it
      this.#log.error(
        { err: this.#serializeError(middlewareError) },
        LOG_MESSAGES.MIDDLEWARE_ERROR_SENT,
      );
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
        statusCode: HTTP_STATUS.NOT_FOUND,
        error: ERROR_MESSAGES.WEBHOOK_NOT_FOUND,
      };
    }

    // 2. IP Whitelisting
    const remoteIp = req.ip || req.socket.remoteAddress;
    if (allowedIps.length > 0) {
      const isAllowed = checkIpInRanges(remoteIp || "", allowedIps);
      if (!isAllowed) {
        return {
          isValid: false,
          statusCode: HTTP_STATUS.FORBIDDEN,
          error: ERROR_MESSAGES.FORBIDDEN_IP,
          remoteIp,
        };
      }
    }

    // 3. Authentication Check
    const authResult = validateAuth(req, authKey);
    if (!authResult.isValid) {
      return {
        isValid: false,
        statusCode: HTTP_STATUS.UNAUTHORIZED,
        error: authResult.error,
      };
    }

    // 4. Payload size check
    const rawHeader = req.headers[HTTP_HEADERS.CONTENT_LENGTH];
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
    const limit = options.maxPayloadSize ?? APP_CONSTS.DEFAULT_PAYLOAD_LIMIT;
    if (contentLength > limit) {
      return {
        isValid: false,
        statusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE,
        error: ERROR_MESSAGES.PAYLOAD_TOO_LARGE(limit),
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
    const { maskSensitiveData, redactBodyPaths } = options;
    const rawContentType =
      req.headers[HTTP_HEADERS.CONTENT_TYPE] || MIME_TYPES.OCTET_STREAM;
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();

    // Heuristic for text-based content types
    const isJson = contentType.includes(HTTP_CONSTS.JSON_KEYWORD);
    const isText =
      HTTP_CONSTS.TEXT_CONTENT_TYPE_PREFIXES.some((prefix) =>
        contentType.startsWith(prefix),
      ) ||
      HTTP_CONSTS.TEXT_CONTENT_TYPE_INCLUDES.some((part) =>
        contentType.includes(part),
      );

    let loggedBody = req.body;
    /** @type {BufferEncoding | undefined} */
    let bodyEncoding;

    // 1. Redaction (MUST run on Object BEFORE stringification if JSON)
    if (
      redactBodyPaths &&
      loggedBody &&
      typeof loggedBody === "object" &&
      !Buffer.isBuffer(loggedBody)
    ) {
      const prefix = "body.";
      const normalizedPaths = redactBodyPaths
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length));

      if (normalizedPaths.length > 0) {
        // Critical: Clone body to avoid mutating req.body used by ForwardingService
        try {
          if (typeof structuredClone === "function") {
            loggedBody = structuredClone(loggedBody);
          } else {
            loggedBody = JSON.parse(JSON.stringify(loggedBody));
          }
          deepRedact(loggedBody, normalizedPaths, LOG_CONSTS.CENSOR_MARKER);
        } catch {
          // Clone failed (circular?), proceed provided best effort or original
        }
      }
    }

    let stringifiedBody = null;

    if (isJson || isText) {
      if (typeof loggedBody === "object" && !Buffer.isBuffer(loggedBody)) {
        try {
          stringifiedBody = JSON.stringify(loggedBody);
          loggedBody = stringifiedBody;
        } catch {
          loggedBody = String(loggedBody); // Fallback
        }
      } else if (Buffer.isBuffer(loggedBody)) {
        loggedBody = loggedBody.toString(ENCODINGS.UTF8);
      }
    } else {
      // Binary handling
      if (Buffer.isBuffer(loggedBody)) {
        bodyEncoding = ENCODINGS.BASE64;
        loggedBody = loggedBody.toString(bodyEncoding);
      } else if (typeof loggedBody === "object") {
        try {
          stringifiedBody = JSON.stringify(loggedBody);
          loggedBody = stringifiedBody;
        } catch {
          loggedBody = LOG_MESSAGES.BINARY_OBJECT_PLACEHOLDER;
        }
      }
    }

    // Size Check & Offloading (Reuse stringified body)
    const contentToSave =
      stringifiedBody ||
      (typeof loggedBody === "string" ? loggedBody : String(loggedBody));

    const sizeCheck = Buffer.byteLength(contentToSave);

    if (sizeCheck > STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD) {
      const kvsKey = generateKvsKey();
      this.#log.info(
        {
          bodySize: sizeCheck,
          threshold: STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD,
          kvsKey,
        },
        LOG_MESSAGES.KVS_OFFLOAD_THRESHOLD_EXCEEDED,
      );

      try {
        await offloadToKvs(kvsKey, contentToSave, contentType);
        const kvsUrl = await getKvsUrl(kvsKey);

        // Replace body with reference
        loggedBody = createReferenceBody({
          key: kvsKey,
          kvsUrl,
          originalSize: sizeCheck,
          note: STORAGE_CONSTS.DEFAULT_OFFLOAD_NOTE,
          data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
        });
        bodyEncoding = undefined;
      } catch (err) {
        this.#log.error(
          { err: this.#serializeError(err) },
          LOG_MESSAGES.KVS_OFFLOAD_FAILED_LARGE_PAYLOAD,
        );
        // Fallback
        const MAX_FALLBACK_SIZE = STORAGE_CONSTS.MAX_DATASET_ITEM_BYTES;
        loggedBody =
          contentToSave.substring(0, MAX_FALLBACK_SIZE) +
          LOG_MESSAGES.TRUNCATED_AND_KVS_FAILED;
      }
    }

    const { loggedHeaders } = maskSensitiveData
      ? { loggedHeaders: this.#maskHeaders(req.headers) }
      : { loggedHeaders: req.headers };

    return { loggedBody, loggedHeaders, contentType, bodyEncoding };
  }

  /**
   * @param {IncomingHttpHeaders} headers
   */
  #maskHeaders(headers) {
    /** @type {Readonly<string[]>} */
    const headersToMask = SENSITIVE_HEADERS;
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        headersToMask.includes(key.toLowerCase())
          ? LOG_CONSTS.MASKED_VALUE
          : value,
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
        /** @type {Partial<Console>} */
        const limitedConsole = {
          log: (...args) => this.#log.debug({ source: "script" }, ...args),
          error: (...args) => this.#log.error({ source: "script" }, ...args),
          warn: (...args) => this.#log.warn({ source: "script" }, ...args),
          info: (...args) => this.#log.info({ source: "script" }, ...args),
        };
        const sandbox = {
          event,
          req,
          console: limitedConsole,
          HTTP_STATUS,
        };
        this.#compiledScript.runInNewContext(sandbox, {
          timeout: APP_CONSTS.SCRIPT_EXECUTION_TIMEOUT_MS,
        });
      } catch (err) {
        const error = /** @type {CommonError} */ (err);
        const isTimeout =
          error.code === NODE_ERROR_CODES.ERR_SCRIPT_EXECUTION_TIMEOUT ||
          error.message?.includes(LOG_MESSAGES.SCRIPT_EXECUTION_TIMEOUT_ERROR);
        this.#log.error(
          {
            webhookId: event.webhookId,
            isTimeout,
            err: this.#serializeError(error),
          },
          isTimeout
            ? LOG_MESSAGES.SCRIPT_EXECUTION_TIMED_OUT(
                APP_CONSTS.SCRIPT_EXECUTION_TIMEOUT_MS,
              )
            : LOG_MESSAGES.SCRIPT_EXECUTION_FAILED,
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

    if (
      event.statusCode >= HTTP_STATUS.BAD_REQUEST &&
      (!responseBody || responseBody === HTTP_CONSTS.DEFAULT_SUCCESS_BODY)
    ) {
      res.json({
        message: LOG_MESSAGES.WEBHOOK_RECEIVED_STATUS(event.statusCode),
        webhookId: event.webhookId,
      });
    } else if (typeof responseBody === "object" && responseBody !== null) {
      res.json(responseBody);
    } else {
      res.send(responseBody);
    }
  }

  /**
   * @param {WebhookEvent} event
   * @param {Request} req
   * @param {LoggerOptions} options
   * @param {AbortSignal} [signal]
   */
  async #executeBackgroundTasks(event, req, options, signal) {
    if (signal?.aborted) return;

    const { forwardUrl } = options;

    try {
      if (event && event.webhookId) {
        // Add timeout to pushData
        await Promise.race([
          Actor.pushData(event),
          new Promise((_, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    ERROR_MESSAGES.ACTOR_PUSH_DATA_TIMEOUT(
                      APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS,
                    ),
                  ),
                ),
              APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS,
            );
            if (timer.unref) timer.unref();
          }),
        ]);

        // Emit internal event for real-time SyncService
        appEvents.emit(EVENT_NAMES.LOG_RECEIVED, event);
        if (this.#onEvent) this.#onEvent(event);
      }

      if (forwardUrl) {
        if (signal?.aborted) return;

        await this.#forwardingService.forwardWebhook(
          event,
          req,
          options,
          forwardUrl,
          signal,
        );
      }
    } catch (error) {
      if (signal?.aborted) return;

      const errorMessage = /** @type {Error} */ (error).message;
      const msg = errorMessage ? errorMessage.toLowerCase() : "";
      const isPlatformError = APP_CONSTS.PLATFORM_ERROR_KEYWORDS.some(
        (keyword) => msg.includes(keyword),
      );

      this.#log.error(
        {
          webhookId: event.webhookId,
          isPlatformError,
          err: this.#serializeError(error),
        },
        isPlatformError
          ? LOG_MESSAGES.PLATFORM_LIMIT_ERROR
          : LOG_MESSAGES.BACKGROUND_ERROR,
      );

      if (isPlatformError) {
        this.#log.warn(LOG_MESSAGES.CHECK_PLATFORM_LIMITS);
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
