import { Actor } from "apify";
import axios from "axios";
import Ajv from "ajv";
import ipRangeCheck from "ip-range-check";
import { nanoid } from "nanoid";
import vm from "vm";
import { validateAuth } from "./utils/auth.js";
import { parseWebhookOptions } from "./utils/config.js";

const ajv = new Ajv();

/**
 * Validates the basic webhook request parameters and permissions.
 */
function validateWebhookRequest(req, webhookId, options, webhookManager) {
  const { authKey, allowedIps } = options;

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
    const isAllowed = ipRangeCheck(remoteIp, allowedIps);
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
  const { isValid: isAuthValid, error: authError } = validateAuth(req, authKey);
  if (!isAuthValid) {
    return {
      isValid: false,
      statusCode: 401,
      error: authError,
    };
  }

  // 4. Payload size check
  const contentLength = parseInt(req.headers["content-length"] || "0");
  if (contentLength > options.maxPayloadSize) {
    return {
      isValid: false,
      statusCode: 413,
      error: "Payload Too Large",
      received: contentLength,
    };
  }

  return { isValid: true, remoteIp, contentLength };
}

/**
 * Prepares the request body, validates JSON schema, and masks headers.
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
      } catch (e) {
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

  const headersToMask = [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "api-key",
  ];
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
 */
function transformRequestData(event, req, compiledScript) {
  if (compiledScript) {
    try {
      const sandbox = { event, req, console };
      compiledScript.runInNewContext(sandbox, { timeout: 1000 });
    } catch (err) {
      console.error(
        `[SCRIPT-EXEC-ERROR] Failed to run custom script for ${event.webhookId}:`,
        err.message,
      );
    }
  }
}

/**
 * Sends the HTTP response back to the client.
 */
function sendResponse(res, event, options) {
  const { defaultResponseBody, defaultResponseHeaders } = options;

  if (defaultResponseHeaders && typeof defaultResponseHeaders === "object") {
    Object.entries(defaultResponseHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  res.status(event.statusCode);

  if (
    event.statusCode >= 400 &&
    (!defaultResponseBody || defaultResponseBody === "OK")
  ) {
    res.json({
      message: `Webhook received with status ${event.statusCode}`,
      webhookId: event.webhookId,
    });
  } else if (typeof defaultResponseBody === "object") {
    res.json(defaultResponseBody);
  } else {
    res.send(defaultResponseBody);
  }
}

/**
 * Handles background tasks like storage and forwarding.
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
        const MAX_RETRIES = 3;
        let attempt = 0;
        let success = false;

        let hostHeader = "";
        try {
          hostHeader = new URL(validatedUrl).host;
        } catch (e) {
          console.error(`[FORWARD-ERROR] Invalid forward URL: ${validatedUrl}`);
          return;
        }

        while (attempt < MAX_RETRIES && !success) {
          try {
            attempt++;

            const sensitiveHeaders = [
              "authorization",
              "cookie",
              "set-cookie",
              "x-api-key",
              "api-key",
            ];

            const forwardingHeaders =
              options.forwardHeaders !== false
                ? Object.fromEntries(
                    Object.entries(req.headers).filter(
                      ([key]) => !sensitiveHeaders.includes(key.toLowerCase()),
                    ),
                  )
                : {
                    "content-type": req.headers["content-type"],
                    "content-length": req.headers["content-length"],
                  };

            await axios.post(validatedUrl, req.body, {
              headers: {
                ...forwardingHeaders,
                "X-Forwarded-By": "Apify-Webhook-Debugger",
                host: hostHeader,
              },
              timeout: 10000,
            });
            success = true;
          } catch (err) {
            const transientErrors = [
              "ECONNABORTED",
              "ECONNRESET",
              "ETIMEDOUT",
              "ENETUNREACH",
              "EHOSTUNREACH",
              "EAI_AGAIN",
            ];
            const isTransient = transientErrors.includes(err.code);
            const delay = 1000 * Math.pow(2, attempt - 1);

            console.error(
              `[FORWARD-ERROR] Attempt ${attempt}/${MAX_RETRIES} failed for ${validatedUrl}:`,
              err.code === "ECONNABORTED" ? "Timed out" : err.message,
            );

            if (attempt >= MAX_RETRIES || !isTransient) {
              try {
                await Actor.pushData({
                  id: nanoid(10),
                  timestamp: new Date().toISOString(),
                  webhookId: event.webhookId,
                  method: "SYSTEM",
                  type: "forward_error",
                  body: `Forwarding to ${validatedUrl} failed${
                    !isTransient ? " (Non-transient error)" : ""
                  } after ${attempt} attempts. Last error: ${err.message}`,
                  statusCode: 500,
                  originalEventId: event.id,
                });
              } catch (pushErr) {
                console.error(
                  "[CRITICAL] Failed to log forward error:",
                  pushErr.message,
                );
              }
              break; // Stop retrying
            } else {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }
      })();

      await forwardingPromise;
    }
  } catch (error) {
    const isPlatformError =
      error.message &&
      (error.message.includes("Dataset") ||
        error.message.includes("quota") ||
        error.message.includes("limit"));

    console.error(
      `[CRITICAL] ${
        isPlatformError ? "PLATFORM-LIMIT" : "BACKGROUND-ERROR"
      } for ${event.webhookId}:`,
      error.message,
    );

    if (isPlatformError) {
      console.warn(
        "[ADVICE] Check your Apify platform limits or storage availability.",
      );
    }
  }
}

export const createLoggerMiddleware = (webhookManager, rawOptions, onEvent) => {
  const options = parseWebhookOptions(rawOptions);

  // Pre-compilation steps
  let compiledScript;
  if (options.customScript) {
    try {
      compiledScript = new vm.Script(options.customScript);
    } catch (err) {
      console.error("[SCRIPT-ERROR] Invalid Custom Script:", err.message);
    }
  }

  let validate;
  if (options.jsonSchema) {
    try {
      const schema =
        typeof options.jsonSchema === "string"
          ? JSON.parse(options.jsonSchema)
          : options.jsonSchema;
      validate = ajv.compile(schema);
    } catch (err) {
      console.error("[SCHEMA-ERROR] Invalid JSON Schema:", err.message);
    }
  }

  return async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.params.id;

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
      return res.status(validation.statusCode).json({
        error: validation.error,
        ip: validation.remoteIp,
        received: validation.received,
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
      const event = {
        id: nanoid(10),
        timestamp: new Date().toISOString(),
        webhookId,
        method: req.method,
        headers: loggedHeaders,
        query: req.query,
        body: loggedBody,
        contentType,
        size: validation.contentLength,
        statusCode: req.forcedStatus || mergedOptions.defaultResponseCode,
        processingTime: 0,
        remoteIp: validation.remoteIp,
        userAgent: req.headers["user-agent"],
      };

      transformRequestData(event, req, compiledScript);

      // 4. Orchestration: Respond synchronous-ish, then race background tasks
      if (mergedOptions.responseDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(mergedOptions.responseDelayMs, 10000)),
        );
      }

      event.processingTime = Date.now() - startTime;
      sendResponse(res, event, mergedOptions);

      // Execute background tasks (storage, forwarding) after response
      const backgroundPromise = async () => {
        try {
          await executeBackgroundTasks(event, req, mergedOptions, onEvent);
        } catch (err) {
          console.error(
            `[CRITICAL] Background tasks for ${event.id} failed:`,
            err.message,
          );
        }
      };

      // Wrap background work in Promise.race to ensure we don't hang the Actor if storage is slow
      const timeoutMs = process.env.NODE_ENV === "test" ? 100 : 10000;
      await Promise.race([
        backgroundPromise(),
        new Promise((resolve) => {
          const t = setTimeout(() => {
            if (process.env.NODE_ENV !== "test") {
              const readableTimeout =
                timeoutMs < 1000 ? `${timeoutMs}ms` : `${timeoutMs / 1000}s`;
              console.warn(
                `[TIMEOUT] Background tasks for ${event.id} exceeded ${readableTimeout}. Continuing...`,
              );
            }
            resolve();
          }, timeoutMs);
          if (t.unref) t.unref();
        }),
      ]);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          error: err.error,
          details: err.details,
        });
      }
      console.error("[CRITICAL] Internal Middleware Error:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
};
