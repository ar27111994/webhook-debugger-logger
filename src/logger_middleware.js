import { Actor } from "apify";

export const createLoggerMiddleware = (
  webhookManager,
  maxPayloadSize,
  onEvent
) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    const webhookId = req.params.id;

    // 1. Validation
    if (!webhookManager.isValid(webhookId)) {
      return res.status(404).json({
        error: "Webhook not found or expired",
        id: webhookId,
        docs: "https://apify.com/ar27111994/webhook-debugger-logger",
      });
    }

    // 2. Payload size check (using content-length header as first defense)
    const contentLength = parseInt(req.headers["content-length"] || "0");
    if (contentLength > maxPayloadSize) {
      return res.status(413).json({
        error: "Payload too large",
        limit: maxPayloadSize,
        received: contentLength,
      });
    }

    // 3. Capture remote IP and User agent
    const remoteIp =
      req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const userAgent = req.headers["user-agent"];

    // 4. Send response
    const status = req.forcedStatus || 200;
    if (status >= 400) {
      res.status(status).json({
        message: `Webhook received with forced status ${status}`,
        webhookId,
      });
    } else {
      res.status(status).send("OK");
    }

    // 5. Log asynchronously
    try {
      const rawContentType =
        req.headers["content-type"] || "application/octet-stream";
      const contentType = rawContentType.split(";")[0].trim().toLowerCase();

      let loggedBody = req.body;

      // If it's a Buffer (from raw body parser), convert to string
      if (Buffer.isBuffer(loggedBody)) {
        loggedBody = loggedBody.toString();
      }

      // If it's an object (from JSON or URL-encoded parser), stringify it
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
        statusCode: status,
        processingTime: Date.now() - startTime,
        remoteIp,
        userAgent,
      };

      if (event && event.webhookId) {
        await Actor.pushData(event);
        if (onEvent) onEvent(event);
      }
    } catch (error) {
      console.error(
        `[CRITICAL] Error logging webhook ${webhookId}:`,
        error.message
      );
    }
  };
};
