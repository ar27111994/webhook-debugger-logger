import { Actor } from "apify";
import Ajv from "ajv";
import { nanoid } from "nanoid";
import vm from "vm";
import { validateAuth } from "./utils/auth.js";
import { getSafeResponseDelay, parseWebhookOptions } from "./utils/config.js";
import { checkIpInRanges } from "./utils/ssrf.js";
import {
  BACKGROUND_TASK_TIMEOUT_PROD_MS,
  BACKGROUND_TASK_TIMEOUT_TEST_MS,
  SCRIPT_EXECUTION_TIMEOUT_MS,
  SENSITIVE_HEADERS,
  DEFAULT_PAYLOAD_LIMIT,
} from "./consts.js";
import { verifySignature } from "./utils/signature.js";
import { triggerAlertIfNeeded } from "./utils/alerting.js";
import { appEvents, EVENTS } from "./utils/events.js";
import { ForwardingService } from "./services/ForwardingService.js";

/**
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("ajv").default} AjvType
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("ajv").ValidateFunction | null} ValidateFunction
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

    // Bind methods where necessary (middleware is used as value)
    this.middleware = this.middleware.bind(this);
    /** @type {any} */ (this.middleware).updateOptions =
      this.updateOptions.bind(this);

    // Initial compilation
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
      console.log(`[SYSTEM] ${successMsg}`);
      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");
      console.error(`[${errorPrefix}] Invalid resource:`, message);
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
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} [_next]
   */
  async middleware(req, res, _next) {
    const startTime = Date.now();
    const webhookId = String(req.params.id);

    // 1. Validate & Load Per-Webhook Options
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

    const mergedOptions = {
      ...this.#options,
      ...webhookOverrides,
    };

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
      const { loggedBody, loggedHeaders, contentType } =
        this.#prepareRequestData(req, mergedOptions);

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
        // Use preserved rawBody if available (critical for Shopify/Stripe signatures)
        // Fallback to re-stringifying body if necessary (though less reliable)
        const rawBody =
          /** @type {any} */ (req).rawBody ||
          (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
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
          console.error(
            `[CRITICAL] Background tasks for ${event.id} failed:`,
            /** @type {Error} */ (err).message,
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
                console.warn(
                  `[TIMEOUT] Background tasks for ${event.id} exceeded ${readableTimeout}. Continuing...`,
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
      console.error(
        "[CRITICAL] Internal Middleware Error:",
        middlewareError.message,
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
   * @returns {{ loggedBody: string, loggedHeaders: Object, contentType: string }}
   */
  #prepareRequestData(req, options) {
    const { maskSensitiveData } = options;
    const rawContentType =
      req.headers["content-type"] || "application/octet-stream";
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();

    let loggedBody = req.body;
    if (Buffer.isBuffer(loggedBody)) {
      loggedBody = loggedBody.toString();
    }

    // JSON Schema Validation
    if (this.#validate && contentType === "application/json") {
      let bodyToValidate = req.body;
      if (typeof bodyToValidate === "string") {
        try {
          bodyToValidate = JSON.parse(bodyToValidate);
        } catch (_) {
          throw {
            statusCode: 400,
            error: "Invalid JSON for schema validation",
          };
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

    // Normalize loggedBody for storage
    if (
      loggedBody &&
      typeof loggedBody === "object" &&
      Object.keys(loggedBody).length > 0
    ) {
      loggedBody = JSON.stringify(loggedBody, null, 2);
    } else if (
      !loggedBody ||
      (typeof loggedBody === "object" && Object.keys(loggedBody).length === 0)
    ) {
      loggedBody = "";
    }

    const headersToMask = SENSITIVE_HEADERS;
    const loggedHeaders = maskSensitiveData
      ? Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [
            key,
            headersToMask.includes(key.toLowerCase()) ? "[MASKED]" : value,
          ]),
        )
      : req.headers;

    return { loggedBody, loggedHeaders, contentType };
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
        console.error(
          `[SCRIPT-EXEC-ERROR] Failed to run custom script for ${event.webhookId}:`,
          isTimeout
            ? `Script execution timed out after ${SCRIPT_EXECUTION_TIMEOUT_MS}ms`
            : error.message,
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

      console.error(
        `[CRITICAL] ${
          isPlatformError ? "PLATFORM-LIMIT" : "BACKGROUND-ERROR"
        } for ${event.webhookId}:`,
        errorMessage,
      );

      if (isPlatformError) {
        console.warn(
          "[ADVICE] Check your Apify platform limits or storage availability.",
        );
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
