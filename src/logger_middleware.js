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
  MAX_FORWARD_RETRIES,
  SCRIPT_EXECUTION_TIMEOUT_MS,
  SENSITIVE_HEADERS,
  DEFAULT_PAYLOAD_LIMIT,
} from "./consts.js";
import { verifySignature } from "./utils/signature.js";
import { triggerAlertIfNeeded } from "./utils/alerting.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('ajv').ValidateFunction | null} ValidateFunction
 * @typedef {import('./webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('./typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('./typedefs.js').LoggerOptions} LoggerOptions
 * @typedef {import('./typedefs.js').CommonError} CommonError
 */

/** @type {import("ajv").default} */
// @ts-expect-error - Ajv's default export is a class constructor but TypeScript infers namespace type; explicit cast required
const ajv = new Ajv();

/**
 * Validates and coerces a forced status code.
 * @param {any} forcedStatus
 * @param {number} [defaultCode=200]
 * @returns {number}
 */
function getValidStatusCode(forcedStatus, defaultCode = 200) {
  const forced = Number(forcedStatus);
  if (Number.isFinite(forced) && forced >= 100 && forced < 600) {
    return forced;
  }
  return defaultCode;
}

/**
 * Validates the basic webhook request parameters and permissions.
 *
 * @param {Request} req
 * @param {string} webhookId
 * @param {LoggerOptions} options
 * @param {WebhookManager} webhookManager
 * @returns {import("./typedefs.js").MiddlewareValidationResult}
 */
function validateWebhookRequest(req, webhookId, options, webhookManager) {
  const authKey = options.authKey || "";
  const allowedIps = options.allowedIps || [];

  // 1. Basic ID Validation
  if (!webhookManager.isValid(webhookId)) {
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
  const authResult = /** @type {import('./typedefs.js').ValidationResult} */ (
    validateAuth(req, authKey)
  );
  if (!authResult.isValid) {
    return {
      isValid: false,
      statusCode: 401,
      error: authResult.error,
    };
  }

  // 4. Payload size check - harden against malformed headers
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

  const contentLength = Number.isFinite(parsedLength) ? parsedLength : bodyLen;
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
 * Prepares the request body, validates JSON schema, and masks headers.
 *
 * @param {Request} req
 * @param {LoggerOptions} options
 * @param {ValidateFunction} validate
 * @returns {{ loggedBody: string, loggedHeaders: Object, contentType: string }}
 */
function prepareRequestData(req, options, validate) {
  const { maskSensitiveData } = options;
  const rawContentType =
    req.headers["content-type"] || "application/octet-stream";
  const contentType = rawContentType.split(";")[0].trim().toLowerCase();

  let loggedBody = req.body;
  if (Buffer.isBuffer(loggedBody)) {
    loggedBody = loggedBody.toString();
  }

  // JSON Schema Validation
  if (validate && contentType === "application/json") {
    let bodyToValidate = req.body;
    if (typeof bodyToValidate === "string") {
      try {
        bodyToValidate = JSON.parse(bodyToValidate);
      } catch (_) {
        throw { statusCode: 400, error: "Invalid JSON for schema validation" };
      }
    }
    const isValid = validate(bodyToValidate);
    if (!isValid) {
      throw {
        statusCode: 400,
        error: "JSON Schema Validation Failed",
        details: validate.errors,
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
 * Executes a custom script to transform the event.
 *
 * @param {WebhookEvent} event
 * @param {Request} req
 * @param {vm.Script | null} compiledScript
 */
function transformRequestData(event, req, compiledScript) {
  if (compiledScript) {
    try {
      const sandbox = { event, req, console };
      compiledScript.runInNewContext(sandbox, {
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
 * Sends the HTTP response back to the client.
 *
 * @param {Response} res
 * @param {WebhookEvent} event
 * @param {LoggerOptions} options
 */
function sendResponse(res, event, options) {
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
    event.responseBody !== undefined ? event.responseBody : defaultResponseBody;

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
 * Handles background tasks like storage and forwarding.
 *
 * @param {WebhookEvent} event
 * @param {Request} req
 * @param {LoggerOptions} options
 * @param {Function} onEvent
 */
async function executeBackgroundTasks(event, req, options, onEvent) {
  const { forwardUrl } = options;

  try {
    if (event && event.webhookId) {
      await Actor.pushData(event);
      if (onEvent) onEvent(event);
    }

    if (forwardUrl) {
      let validatedUrl = forwardUrl.startsWith("http")
        ? forwardUrl
        : `http://${forwardUrl}`;

      const forwardingPromise = (async () => {
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

        while (attempt < MAX_FORWARD_RETRIES && !success) {
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
            const transientErrors = [
              "ECONNABORTED",
              "ECONNRESET",
              "ETIMEDOUT",
              "ENETUNREACH",
              "EHOSTUNREACH",
              "EAI_AGAIN",
            ];
            const isTransient = transientErrors.includes(axiosError.code || "");
            const delay = 1000 * Math.pow(2, attempt - 1);

            console.error(
              `[FORWARD-ERROR] Attempt ${attempt}/${MAX_FORWARD_RETRIES} failed for ${validatedUrl}:`,
              axiosError.code === "ECONNABORTED"
                ? "Timed out"
                : axiosError.message,
            );

            if (attempt >= MAX_FORWARD_RETRIES || !isTransient) {
              try {
                await Actor.pushData({
                  id: nanoid(10),
                  timestamp: new Date().toISOString(),
                  webhookId: event.webhookId,
                  method: "SYSTEM",
                  type: "forward_error",
                  body: `Forwarding to ${validatedUrl} failed${
                    !isTransient ? " (Non-transient error)" : ""
                  } after ${attempt} attempts. Last error: ${
                    axiosError.message
                  }`,
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
      })();

      await forwardingPromise;
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
 * @typedef {Function} LoggerMiddleware
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} [next]
 * @returns {Promise<void>}
 */

/**
 * Creates the logger middleware instance with hot-reload support.
 *
 * @param {WebhookManager} webhookManager
 * @param {Object} rawOptions
 * @param {Function} onEvent
 * @returns {LoggerMiddleware & { updateOptions: Function }}
 */
export const createLoggerMiddleware = (webhookManager, rawOptions, onEvent) => {
  /** @type {LoggerOptions | undefined} */
  let options; // Initialized as undefined to trigger initial compilation
  /** @type {vm.Script | null} */
  let compiledScript = null;
  /** @type {ValidateFunction} */
  let validate = null;

  /**
   * @param {LoggerOptions} newOptions
   */
  const refreshCompilations = (newOptions) => {
    // 1. Smart script re-compilation
    if (!options || newOptions.customScript !== options.customScript) {
      if (newOptions.customScript) {
        try {
          compiledScript = new vm.Script(newOptions.customScript);
          console.log("[SYSTEM] Custom script re-compiled successfully.");
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err ?? "Unknown error");
          console.error("[SCRIPT-ERROR] Invalid Custom Script:", message);
          compiledScript = null; // Clear on failure
        }
      } else {
        compiledScript = null;
      }
    }

    // 2. Smart schema re-compilation
    const oldSchemaStr =
      options && typeof options.jsonSchema === "object"
        ? JSON.stringify(options.jsonSchema)
        : options?.jsonSchema;
    const newSchemaStr =
      typeof newOptions.jsonSchema === "object"
        ? JSON.stringify(newOptions.jsonSchema)
        : newOptions.jsonSchema;

    if (!options || newSchemaStr !== oldSchemaStr) {
      if (newOptions.jsonSchema) {
        try {
          const schema =
            typeof newOptions.jsonSchema === "string"
              ? JSON.parse(newOptions.jsonSchema)
              : newOptions.jsonSchema;
          validate = ajv.compile(schema);
          console.log("[SYSTEM] JSON Schema re-compiled successfully.");
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err ?? "Unknown error");
          console.error("[SCHEMA-ERROR] Invalid JSON Schema:", message);
          validate = null; // Clear on failure
        }
      } else {
        validate = null;
      }
    }
  };

  // Initial compilation
  const initialOptions = parseWebhookOptions(rawOptions);
  refreshCompilations(initialOptions);
  options = initialOptions;

  /**
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} [_next]
   */
  const middleware = async (req, res, _next) => {
    const startTime = Date.now();
    const webhookId = String(req.params.id);

    // 1. Validate & Load Per-Webhook Options
    const webhookData = webhookManager.getWebhookData(webhookId) || {};

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
      ...options,
      ...webhookOverrides,
    };

    const validation = validateWebhookRequest(
      req,
      webhookId,
      mergedOptions,
      webhookManager,
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
      const { loggedBody, loggedHeaders, contentType } = prepareRequestData(
        req,
        mergedOptions,
        validate,
      );

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
        statusCode: getValidStatusCode(
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
        const rawBody =
          typeof req.body === "string" ? req.body : JSON.stringify(req.body);
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

      transformRequestData(event, req, compiledScript);

      // 4. Orchestration: Respond synchronous-ish, then race background tasks
      const delayMs = getSafeResponseDelay(mergedOptions.responseDelayMs);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      event.processingTime = Date.now() - startTime;
      sendResponse(res, event, mergedOptions);

      // Execute background tasks (storage, forwarding, alerting) after response
      const backgroundPromise = async () => {
        try {
          await executeBackgroundTasks(event, req, mergedOptions, onEvent);

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
  };

  // Add hot-reload capability
  /** @param {Object} newRawOptions */
  middleware.updateOptions = (newRawOptions) => {
    const newOptions = parseWebhookOptions(newRawOptions);
    refreshCompilations(newOptions);
    options = newOptions; // Switch to new options
  };

  return middleware;
};
