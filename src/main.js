import { Actor } from "apify";
import express from "express";
import bodyParser from "body-parser";
import { WebhookManager } from "./webhook_manager.js";
import { createLoggerMiddleware } from "./logger_middleware.js";

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
  urlCount = 3,
  retentionHours = 24,
  maxPayloadSize = 10485760, // 10MB
  enableJSONParsing = true,
} = input;

const webhookManager = new WebhookManager();
await webhookManager.init();

// Open dataset once
const dataset = await Actor.openDataset();

// Generate initial webhooks if none exist
const active = webhookManager.getAllActive();
if (active.length === 0) {
  const ids = await webhookManager.generateWebhooks(urlCount, retentionHours);
  console.log(`Generated ${ids.length} new webhooks:`, ids);
} else {
  console.log(`Resuming with ${active.length} active webhooks.`);
}

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true, limit: maxPayloadSize }));
app.use(bodyParser.raw({ limit: maxPayloadSize, type: "*/*" }));

if (enableJSONParsing) {
  app.use((req, res, next) => {
    if (!req.body || Buffer.isBuffer(req.body) === false) return next();

    // Try to parse as JSON if it looks like JSON
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

// Helper to broadcast events to SSE clients
const broadcast = (data) => {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => client.write(message));
};

// Routes
// Allow override status code via ?__status=XXX
app.all(
  "/webhook/:id",
  (req, res, next) => {
    const statusOverride = parseInt(req.query.__status);
    if (statusOverride >= 100 && statusOverride < 600) {
      req.forcedStatus = statusOverride;
    }
    next();
  },
  createLoggerMiddleware(webhookManager, maxPayloadSize, broadcast)
);

// SSE endpoint for real-time streaming
app.get("/log-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.add(res);
  console.log(`New SSE client connected. Total: ${clients.size}`);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`SSE client disconnected. Total: ${clients.size}`);
  });
});

// Logs endpoint with filtering
app.get("/logs", async (req, res) => {
  try {
    const {
      webhookId,
      method,
      statusCode,
      contentType,
      limit = 100,
    } = req.query;

    // Open default dataset
    const localDataset = await Actor.openDataset();

    let items = [];
    try {
      const result = await localDataset.getData();
      items = result.items || [];
    } catch (e) {
      console.error("Failed to get data from dataset:", e.message);
      // Fallback: items remains empty if dataset is not yet initialized in memory-storage
    }

    // Apply filters and sort in-memory
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
    console.error("Error in /logs:", error);
    res.status(500).json({
      error: "Unexpected error in /logs",
      message: error.message,
    });
  }
});

// Info endpoint to see active webhooks
app.get("/info", (req, res) => {
  res.json({
    activeWebhooks: webhookManager.getAllActive(),
    endpoints: {
      logs: "/logs?webhookId=wh_XXX&method=POST&statusCode=200",
      stream: "/log-stream",
      webhook: "/webhook/:id",
    },
    docs: "https://apify.com/ar27111994/webhook-debugger-logger",
  });
});

// Root endpoint redirect
app.get("/", (req, res) => {
  res.send(
    "Webhook Debugger is running. Use /webhook/:id to log requests or /info to see active URLs."
  );
});

// Start Server
const port = process.env.ACTOR_WEB_SERVER_PORT || 8080;
const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// Periodic Cleanup (every 10 minutes)
const cleanupInterval = setInterval(async () => {
  console.log("Running TTL cleanup...");
  await webhookManager.cleanup();
}, 10 * 60 * 1000);

// Graceful Shutdown
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
