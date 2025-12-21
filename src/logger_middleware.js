import { Actor } from "apify";
import axios from "axios";
import Ajv from "ajv";
import ipRangeCheck from "ip-range-check";

const ajv = new Ajv();

export const createLoggerMiddleware = (webhookManager, options, onEvent) => {
  const {
    maxPayloadSize,
    authKey,
    allowedIps = [],
    defaultResponseCode = 200,
    defaultResponseBody = "OK",
    defaultResponseHeaders = {},
    responseDelayMs = 0,
    forwardUrl,
    jsonSchema,
  } = options;

  // Pre-compile schema if provided
  let validate;
  if (jsonSchema) {
    try {
      const schema =
        typeof jsonSchema === "string" ? JSON.parse(jsonSchema) : jsonSchema;
      validate = ajv.compile(schema);
    } catch (err) {
      console.error(
        "[SCHEMA-ERROR] Invalid JSON Schema provided:",
        err.message
      );
    }
  }

  return async (req, res, next) => {
    const startTime = Date.now();
    const webhookId = req.params.id;

    // 1. Basic ID Validation
    if (!webhookManager.isValid(webhookId)) {
      return res.status(404).json({
        error: "Webhook not found or expired",
        id: webhookId,
        docs: "https://apify.com/ar27111994/webhook-debugger-logger",
      });
    }

    // 2. IP Whitelisting (CIDR Support)
    const remoteIp =
      req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    if (allowedIps.length > 0) {
      const isAllowed = ipRangeCheck(remoteIp, allowedIps);
      if (!isAllowed) {
        return res.status(403).json({
          error: "Forbidden: IP not in whitelist",
          ip: remoteIp,
        });
      }
    }

    // 3. Authentication Check
    if (authKey) {
      const providedKey =
        req.query.key ||
        (req.headers["authorization"] || "").replace("Bearer ", "");
      if (providedKey !== authKey) {
        return res.status(401).json({
          error: "Unauthorized: Invalid or missing API key",
        });
      }
    }

    // 4. Payload size check
    const contentLength = parseInt(req.headers["content-length"] || "0");
    if (contentLength > maxPayloadSize) {
      return res.status(413).json({
        error: "Payload too large",
        limit: maxPayloadSize,
        received: contentLength,
      });
    }

    // 5. Preparation for logging & Validation
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
          return res
            .status(400)
            .json({ error: "Invalid JSON for schema validation" });
        }
      }
      const isValid = validate(bodyToValidate);
      if (!isValid) {
        return res.status(400).json({
          error: "JSON Schema Validation Failed",
          details: validate.errors,
        });
      }
    }

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

    const event = {
      timestamp: new Date().toISOString(),
      webhookId,
      method: req.method,
      headers: req.headers,
      query: req.query,
      body: loggedBody,
      contentType,
      size: contentLength,
      statusCode: req.forcedStatus || defaultResponseCode,
      processingTime: 0,
      remoteIp,
      userAgent: req.headers["user-agent"],
    };

    const sendResponse = () => {
      event.processingTime = Date.now() - startTime;

      if (
        defaultResponseHeaders &&
        typeof defaultResponseHeaders === "object"
      ) {
        Object.keys(defaultResponseHeaders).forEach((key) => {
          res.setHeader(key, defaultResponseHeaders[key]);
        });
      }

      res.status(event.statusCode);

      if (
        event.statusCode >= 400 &&
        (!defaultResponseBody || defaultResponseBody === "OK")
      ) {
        res.json({
          message: `Webhook received with status ${event.statusCode}`,
          webhookId,
        });
      } else {
        res.send(defaultResponseBody);
      }
    };

    if (responseDelayMs > 0) {
      setTimeout(sendResponse, Math.min(responseDelayMs, 10000));
    } else {
      sendResponse();
    }

    try {
      if (event && event.webhookId) {
        await Actor.pushData(event);
        if (onEvent) onEvent(event);
      }

      if (forwardUrl) {
        axios
          .post(forwardUrl, req.body, {
            headers: {
              ...req.headers,
              "X-Forwarded-By": "Apify-Webhook-Debugger",
              host: new URL(forwardUrl).host,
            },
          })
          .catch((err) => {
            console.error(
              `[FORWARD-ERROR] Failed to forward to ${forwardUrl}:`,
              err.message
            );
          });
      }
    } catch (error) {
      console.error(
        `[CRITICAL] Error in background tasks for ${webhookId}:`,
        error.message
      );
    }
  };
};
