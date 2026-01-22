import { Actor } from "apify";
import axios from "axios";
import Ajv from "ajv";
import { nanoid } from "nanoid";
import vm from "vm";
import { validateAuth } from "./utils/auth.js";
import { getSafeResponseDelay, parseWebhookOptions } from "./utils/config.js";
import { validateUrlForSsrf, checkIpInRanges } from "./utils/ssrf.js";
import {
  BACKGROUND_TASK_TIMEOUT_PROD_MS,
  BACKGROUND_TASK_TIMEOUT_TEST_MS,
  FORWARD_HEADERS_TO_IGNORE,
  FORWARD_TIMEOUT_MS,
  SCRIPT_EXECUTION_TIMEOUT_MS,
  SENSITIVE_HEADERS,
  DEFAULT_PAYLOAD_LIMIT,
  DEFAULT_FORWARD_RETRIES,
  TRANSIENT_ERROR_CODES,
} from "./consts.js";
import { verifySignature } from "./utils/signature.js";
import { triggerAlertIfNeeded } from "./utils/alerting.js";

/**
 * @typedef {import('express').RequestHandler} RequestHandler
 * @typedef {import("ajv").default} Ajv
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('ajv').ValidateFunction | null} ValidateFunction
 * @typedef {import('./webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('./typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('./typedefs.js').LoggerOptions} LoggerOptions
 * @typedef {import('./typedefs.js').CommonError} CommonError
 * @typedef {import('./typedefs.js').MiddlewareValidationResult} MiddlewareValidationResult
 */

/** @type {Ajv} */
// @ts-expect-error - Ajv's default export is a class constructor but TypeScript infers namespace type; explicit cast required
const ajv = new Ajv();

/**
 * Validates and coerces a forced status code.
 * @param {any} forcedStatus
 * @param {number} [defaultCode=200]
 * @returns {number}
 */
export class LoggerMiddleware {
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
   */
  constructor(webhookManager, rawOptions, onEvent) {
    this.webhookManager = webhookManager;
    this.onEvent = onEvent;

    /** @type {vm.Script | null} */
    this.compiledScript = null;
    /** @type {ValidateFunction} */
    this.validate = null;

    // Bind methods where necessary (middleware is used as value)
    this.middleware = this.middleware.bind(this);
    /** @type {any} */ (this.middleware).updateOptions =
      this.updateOptions.bind(this);

    // Initial compilation
    const options = parseWebhookOptions(rawOptions);
    this._refreshCompilations(options);
    /** @type {LoggerOptions} */
    this.options = options;
  }

  /**
   * @param {Object} newRawOptions
   */
  updateOptions(newRawOptions) {
    const newOptions = parseWebhookOptions(newRawOptions);
    this._refreshCompilations(newOptions);
    this.options = newOptions; // Switch to new options
  }

  /**
   * @param {LoggerOptions} newOptions
   */
  _refreshCompilations(newOptions) {
    // 1. Smart script re-compilation
    if (
      !this.options ||
      newOptions.customScript !== this.options.customScript
    ) {
      if (newOptions.customScript) {
        try {
          this.compiledScript = new vm.Script(newOptions.customScript);
          console.log("[SYSTEM] Custom script re-compiled successfully.");
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err ?? "Unknown error");
          console.error("[SCRIPT-ERROR] Invalid Custom Script:", message);
          this.compiledScript = null; // Clear on failure
        }
      } else {
        this.compiledScript = null;
      }
    }

    // 2. Smart schema re-compilation
    const oldSchemaStr =
      this.options && typeof this.options.jsonSchema === "object"
        ? JSON.stringify(this.options.jsonSchema)
        : this.options?.jsonSchema;
    const newSchemaStr =
      typeof newOptions.jsonSchema === "object"
        ? JSON.stringify(newOptions.jsonSchema)
        : newOptions.jsonSchema;

    if (!this.options || newSchemaStr !== oldSchemaStr) {
      if (newOptions.jsonSchema) {
        try {
          const schema =
            typeof newOptions.jsonSchema === "string"
              ? JSON.parse(newOptions.jsonSchema)
              : newOptions.jsonSchema;
          this.validate = ajv.compile(schema);
          console.log("[SYSTEM] JSON Schema re-compiled successfully.");
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err ?? "Unknown error");
          console.error("[SCHEMA-ERROR] Invalid JSON Schema:", message);
          this.validate = null; // Clear on failure
        }
      } else {
        this.validate = null;
      }
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
    const webhookData = this.webhookManager.getWebhookData(webhookId) || {};

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
      ...this.options,
      ...webhookOverrides,
    };

    const validation = this._validateWebhookRequest(
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
        this._prepareRequestData(req, mergedOptions);

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

      this._transformRequestData(event, req);

      // 4. Orchestration: Respond synchronous-ish, then race background tasks
      const delayMs = getSafeResponseDelay(mergedOptions.responseDelayMs);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      event.processingTime = Date.now() - startTime;
      this._sendResponse(res, event, mergedOptions);

      // Execute background tasks (storage, forwarding, alerting) after response
      const backgroundPromise = async () => {
        try {
          await this._executeBackgroundTasks(event, req, mergedOptions);

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
  _validateWebhookRequest(req, webhookId, options) {
    const authKey = options.authKey || "";
    const allowedIps = options.allowedIps || [];

    // 1. Basic ID Validation
    if (!this.webhookManager.isValid(webhookId)) {
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
  _prepareRequestData(req, options) {
    const { maskSensitiveData } = options;
    const rawContentType =
      req.headers["content-type"] || "application/octet-stream";
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();

    let loggedBody = req.body;
    if (Buffer.isBuffer(loggedBody)) {
      loggedBody = loggedBody.toString();
    }

    // JSON Schema Validation
    if (this.validate && contentType === "application/json") {
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
      const isValid = this.validate(bodyToValidate);
      if (!isValid) {
        throw {
          statusCode: 400,
          error: "JSON Schema Validation Failed",
          details: this.validate.errors,
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
  _transformRequestData(event, req) {
    if (this.compiledScript) {
      try {
        const sandbox = { event, req, console };
        this.compiledScript.runInNewContext(sandbox, {
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
  _sendResponse(res, event, options) {
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
  async _executeBackgroundTasks(event, req, options) {
    const { forwardUrl } = options;

    try {
      if (event && event.webhookId) {
        await Actor.pushData(event);
        if (this.onEvent) this.onEvent(event);
      }

      if (forwardUrl) {
        await this._forwardWebhook(event, req, options, forwardUrl);
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

  /**
   * @param {WebhookEvent} event
   * @param {Request} req
   * @param {LoggerOptions} options
   * @param {string} forwardUrl
   */
  async _forwardWebhook(event, req, options, forwardUrl) {
    let validatedUrl = forwardUrl.startsWith("http")
      ? forwardUrl
      : `http://${forwardUrl}`;

    let attempt = 0;
    let success = false;

    // SSRF validation for forwardUrl
    const ssrfResult = await validateUrlForSsrf(validatedUrl);
    if (!ssrfResult.safe) {
      console.error(
        `[FORWARD-ERROR] SSRF blocked: ${ssrfResult.error} for ${validatedUrl}`,
      );
      return;
    }
    const hostHeader = ssrfResult.host || "";
    validatedUrl = ssrfResult.href || validatedUrl;

    while (
      attempt < (options.maxForwardRetries ?? DEFAULT_FORWARD_RETRIES) &&
      !success
    ) {
      try {
        attempt++;

        const sensitiveHeaders = FORWARD_HEADERS_TO_IGNORE;

        const forwardingHeaders =
          options.forwardHeaders !== false
            ? Object.fromEntries(
                Object.entries(req.headers).filter(
                  ([key]) => !sensitiveHeaders.includes(key.toLowerCase()),
                ),
              )
            : {
                "content-type": req.headers["content-type"],
              };

        await axios.post(validatedUrl, req.body, {
          headers: {
            ...forwardingHeaders,
            "X-Forwarded-By": "Apify-Webhook-Debugger",
            host: hostHeader,
          },
          timeout: FORWARD_TIMEOUT_MS,
          maxRedirects: 0,
        });
        success = true;
      } catch (err) {
        const axiosError = /** @type {CommonError} */ (err);
        const isTransient = TRANSIENT_ERROR_CODES.includes(
          axiosError.code || "",
        );
        const delay = 1000 * Math.pow(2, attempt - 1);

        console.error(
          `[FORWARD-ERROR] Attempt ${attempt}/${
            options.maxForwardRetries ?? DEFAULT_FORWARD_RETRIES
          } failed for ${validatedUrl}:`,
          axiosError.code === "ECONNABORTED" ? "Timed out" : axiosError.message,
        );

        if (
          attempt >= (options.maxForwardRetries ?? DEFAULT_FORWARD_RETRIES) ||
          !isTransient
        ) {
          try {
            await Actor.pushData({
              id: nanoid(10),
              timestamp: new Date().toISOString(),
              webhookId: event.webhookId,
              method: "SYSTEM",
              type: "forward_error",
              body: `Forwarding to ${validatedUrl} failed${
                !isTransient ? " (Non-transient error)" : ""
              } after ${attempt} attempts. Last error: ${axiosError.message}`,
              statusCode: 500,
              originalEventId: event.id,
            });
          } catch (pushErr) {
            console.error(
              "[CRITICAL] Failed to log forward error:",
              /** @type {Error} */ (pushErr).message,
            );
          }
          break; // Stop retrying
        } else {
          await new Promise((resolve) => {
            const h = setTimeout(resolve, delay);
            if (h.unref) h.unref();
          });
        }
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
