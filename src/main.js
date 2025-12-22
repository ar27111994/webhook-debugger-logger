import { Actor } from "apify";
import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import axios from "axios";
import { WebhookManager } from "./webhook_manager.js";
import { createLoggerMiddleware } from "./logger_middleware.js";

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
  urlCount = 3,
  retentionHours = 24,
  maxPayloadSize = 10485760, // 10MB
  enableJSONParsing = true,
  // v2.0 Features
  authKey,
  allowedIps = [],
  defaultResponseCode = 200,
  defaultResponseBody = "OK",
  defaultResponseHeaders = {},
  responseDelayMs = 0,
  forwardUrl,
  jsonSchema,
  customScript,
} = input;

const webhookManager = new WebhookManager();
await webhookManager.init();

const active = webhookManager.getAllActive();
if (active.length === 0) {
  const ids = await webhookManager.generateWebhooks(urlCount, retentionHours);
  console.log(`Generated ${ids.length} new webhooks:`, ids);
} else {
  console.log(`Resuming with ${active.length} active webhooks.`);
}

const app = express();
app.use(compression());

app.use(bodyParser.urlencoded({ extended: true, limit: maxPayloadSize }));
app.use(bodyParser.raw({ limit: maxPayloadSize, type: "*/*" }));

if (enableJSONParsing) {
  app.use((req, res, next) => {
    if (!req.body || Buffer.isBuffer(req.body) === false) return next();
    if (req.headers["content-type"]?.includes("application/json")) {
      try {
        req.body = JSON.parse(req.body.toString());
      } catch (e) {
        req.body = req.body.toString();
      }
    } else {
      req.body = req.body.toString();
    }
    next();
  });
}

const clients = new Set();
const broadcast = (data) => {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => client.write(message));
};

// 1. WEBHOOK ENDPOINT
app.all(
  "/webhook/:id",
  (req, res, next) => {
    const statusOverride = parseInt(req.query.__status);
    if (statusOverride >= 100 && statusOverride < 600) {
      req.forcedStatus = statusOverride;
    }
    next();
  },
  createLoggerMiddleware(
    webhookManager,
    {
      maxPayloadSize,
      authKey,
      allowedIps,
      defaultResponseCode,
      defaultResponseBody,
      defaultResponseHeaders,
      responseDelayMs,
      forwardUrl,
      jsonSchema,
      customScript,
    },
    broadcast
  )
);

// 2. REPLAY ENDPOINT (v2.0)
app.get("/replay/:webhookId/:itemId", async (req, res) => {
  try {
    const { webhookId, itemId } = req.params;
    const targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).json({
        error: "Missing 'url' query parameter for replay destination.",
      });
    }

    const dataset = await Actor.openDataset();
    const { items } = await dataset.getData();

    // Find the specific item (dataset doesn't easily filter by field in one call without extra logic)
    const item = items.find(
      (i) =>
        i.webhookId === webhookId && (i.id === itemId || i.timestamp === itemId)
    );

    if (!item) {
      return res.status(404).json({ error: "Logged event not found." });
    }

    console.log(`[REPLAY] Resending event ${itemId} to ${targetUrl}`);

    const response = await axios({
      method: item.method,
      url: targetUrl,
      data: item.body,
      headers: {
        ...item.headers,
        "X-Apify-Replay": "true",
        "X-Original-Webhook-Id": webhookId,
        host: new URL(targetUrl).host,
      },
      validateStatus: () => true,
      timeout: 10000,
    });

    res.json({
      status: "Replayed",
      targetUrl,
      targetResponseCode: response.status,
      targetResponseBody: response.data,
    });
  } catch (error) {
    const isTimeout = error.code === "ECONNABORTED";
    res.status(isTimeout ? 504 : 500).json({
      error: "Replay failed",
      message: isTimeout
        ? "Target destination timed out after 10s"
        : error.message,
      code: error.code,
    });
  }
});

app.get("/log-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  clients.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.get("/logs", async (req, res) => {
  try {
    let {
      webhookId,
      method,
      statusCode,
      contentType,
      limit = 100,
      offset = 0,
    } = req.query;

    // 1. Sanitize & Cap inputs
    limit = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);
    offset = Math.max(parseInt(offset) || 0, 0);

    const localDataset = await Actor.openDataset();

    // 2. Memory-efficient retrieval: fetch only what's needed
    // If filtering is applied, we fetch a slightly larger window to increase match probability
    const result = await localDataset.getData({
      limit:
        webhookId || method || statusCode || contentType ? limit * 2 : limit,
      offset,
      desc: true, // Fetch newest first naturally
    });
    let items = result.items || [];

    let filtered = items.filter((item) => {
      let match = true;
      if (webhookId && item.webhookId !== webhookId) match = false;
      if (method && item.method?.toUpperCase() !== method.toUpperCase())
        match = false;
      if (statusCode && parseInt(item.statusCode) !== parseInt(statusCode))
        match = false;
      if (
        contentType &&
        !item.contentType?.toLowerCase().includes(contentType.toLowerCase())
      )
        match = false;
      if (match && !webhookManager.isValid(item.webhookId)) match = false;
      return match;
    });

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({
      count: Math.min(filtered.length, parseInt(limit)),
      total: filtered.length,
      filters: { webhookId, method, statusCode, contentType },
      items: filtered.slice(0, parseInt(limit)),
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Unexpected error in /logs", message: error.message });
  }
});

app.get("/info", (req, res) => {
  res.json({
    activeWebhooks: webhookManager.getAllActive(),
    v2_features: [
      "Auth Key Support",
      "IP Whitelisting",
      "Custom Responses",
      "Mocking Delay",
      "HTTP Forwarding",
      "Request Replay",
    ],
    endpoints: {
      logs: "/logs?webhookId=wh_XXX&method=POST&statusCode=200",
      stream: "/log-stream",
      webhook: "/webhook/:id",
      replay: "/replay/:webhookId/:timestamp?url=http://your-goal.com",
    },
    docs: "https://apify.com/ar27111994/webhook-debugger-logger",
  });
});

app.get("/", (req, res) => {
  res.send(
    "Webhook Debugger v2.0 (Enterprise) is running. Use /info to explore premium features."
  );
});

// GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("[EXPRESS-ERROR]", err.message);
  if (res.headersSent) return next(err);

  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: "Internal Server Error",
    message: err.message,
    type: err.name,
  });
});

const port = process.env.ACTOR_WEB_SERVER_PORT || 8080;
const server = app.listen(port, () =>
  console.log(`Server listening on port ${port}`)
);

const cleanupInterval = setInterval(async () => {
  console.log("Running TTL cleanup...");
  await webhookManager.cleanup();
}, 10 * 60 * 1000);

const shutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down...`);
  clearInterval(cleanupInterval);
  server.close(async () => {
    await webhookManager.persist();
    await Actor.exit();
    process.exit(0);
  });
};

Actor.on("migrating", () => shutdown("MIGRATING"));
Actor.on("aborting", () => shutdown("ABORTING"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
