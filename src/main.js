import { Actor } from "apify";
import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import axios from "axios";
import { WebhookManager } from "./webhook_manager.js";
import { createLoggerMiddleware } from "./logger_middleware.js";
import { parseWebhookOptions } from "./utils/config.js";
import { validateAuth } from "./utils/auth.js";
import { RateLimiter } from "./utils/rate_limiter.js";

const SSE_HEARTBEAT_INTERVAL_MS = 30000;
const SHUTDOWN_TIMEOUT_MS = 30000;
const STARTUP_TEST_EXIT_DELAY_MS = 5000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_REPLAY_RETRIES = 3;
const REPLAY_TIMEOUT_MS = 10000;

let server;
let sseHeartbeat;
let cleanupInterval;
let webhookRateLimiter;

const webhookManager = new WebhookManager();
const clients = new Set();
const app = express(); // Exported for tests

/**
 * @typedef {Object} WebhookItem
 * @property {string} id
 * @property {string} webhookId
 * @property {string} method
 * @property {Object} headers
 * @property {any} body
 * @property {string} timestamp
 * @property {number} statusCode
 */

/**
 * Simple HTML escaping for security.
 * @param {string} unsafe
 * @returns {string}
 */
const escapeHtml = (unsafe) => {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * Broadcasts data to all connected SSE clients.
 * @param {any} data
 */
const broadcast = (data) => {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => client.write(message));
};

/**
 * Gracefully shuts down the server and persists state.
 * @param {string} signal
 */
const shutdown = async (signal) => {
  if (cleanupInterval) clearInterval(cleanupInterval);
  if (sseHeartbeat) clearInterval(sseHeartbeat);
  if (webhookRateLimiter) webhookRateLimiter.destroy();

  if (process.env.NODE_ENV === "test" && signal !== "TEST_COMPLETE") return;

  console.log(`Received ${signal}. Shutting down...`);
  const forceExitTimer = setTimeout(() => {
    console.error("Forceful shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  const finalCleanup = async () => {
    await webhookManager.persist();
    await Actor.exit();
    clearTimeout(forceExitTimer);
    if (process.env.NODE_ENV !== "test") process.exit(0);
  };

  if (server && server.listening) {
    server.close(finalCleanup);
  } else {
    await finalCleanup();
  }
};

/**
 * Main initialization logic.
 * @returns {Promise<import("express").Application>}
 */
async function initialize() {
  await Actor.init();

  const input = /** @type {any} */ ((await Actor.getInput()) || {});
  const config = parseWebhookOptions(input);
  const {
    urlCount = 3,
    retentionHours = 24,
    maxPayloadSize = 10485760,
    enableJSONParsing = true,
  } = input;

  const { authKey, rateLimitPerMinute: rawRateLimit } = config;
  const rateLimitPerMinute = Math.max(1, Math.floor(rawRateLimit || 60));
  const testAndExit = input.testAndExit || false;

  await webhookManager.init();

  if (process.env.NODE_ENV !== "test") {
    try {
      await Actor.pushData({
        id: "startup-" + Date.now(),
        timestamp: new Date().toISOString(),
        method: "SYSTEM",
        type: "startup",
        body: "Enterprise Webhook Suite initialized.",
        statusCode: 200,
      });
      console.log("🚀 Startup event pushed to dataset.");
    } catch (e) {
      console.warn("Startup log failed:", e.message);
    }
    if (testAndExit)
      setTimeout(() => shutdown("TESTANDEXIT"), STARTUP_TEST_EXIT_DELAY_MS);
  }

  const active = webhookManager.getAllActive();

  // 1. Reconcile URL Count (Dynamic Scaling)
  if (active.length < urlCount) {
    const diff = urlCount - active.length;
    console.log(
      `[SYSTEM] Scaling up: Generating ${diff} additional webhook(s).`
    );
    await webhookManager.generateWebhooks(diff, retentionHours);
  } else if (active.length > urlCount) {
    console.log(
      `[SYSTEM] Notice: Active webhooks (${active.length}) exceed requested count (${urlCount}). No new IDs generated.`
    );
  } else {
    console.log(`[SYSTEM] Resuming with ${active.length} active webhooks.`);
  }

  // 2. Sync Retention (Global Extension)
  await webhookManager.updateRetention(retentionHours);

  // --- Express Middleware ---
  app.set("trust proxy", true);
  app.use(compression());
  app.use(bodyParser.urlencoded({ extended: true, limit: maxPayloadSize }));
  app.use(bodyParser.raw({ limit: maxPayloadSize, type: "*/*" }));

  if (enableJSONParsing) {
    app.use((req, res, next) => {
      if (!req.body || Buffer.isBuffer(req.body) === false) return next();
      if (req.headers["content-type"]?.includes("application/json")) {
        try {
          req.body = JSON.parse(req.body.toString());
        } catch (_) {
          req.body = req.body.toString();
        }
      } else {
        req.body = req.body.toString();
      }
      next();
    });
  }

  let currentAuthKey = authKey;
  let currentRetentionHours = retentionHours;
  let currentUrlCount = urlCount;

  webhookRateLimiter = new RateLimiter(rateLimitPerMinute, 60000);
  const mgmtRateLimiter = webhookRateLimiter.middleware();
  const loggerMiddleware = createLoggerMiddleware(
    webhookManager,
    { ...config, maxPayloadSize },
    broadcast
  );

  // --- Hot Reloading Logic ---
  // @ts-ignore
  Actor.on("input", async (newInput) => {
    if (!newInput) return;
    console.log("[SYSTEM] Detected input update! Applying new settings...");

    try {
      const newConfig = parseWebhookOptions(newInput);
      const newRateLimit = Math.max(
        1,
        Math.floor(newConfig.rateLimitPerMinute || 60)
      );

      // 1. Update Middleware
      loggerMiddleware.updateOptions({ ...newConfig, maxPayloadSize });

      // 2. Update Rate Limiter
      webhookRateLimiter.limit = newRateLimit;

      // 3. Update Auth Key
      currentAuthKey = newConfig.authKey;

      // 4. Re-reconcile URL count
      currentUrlCount = newInput.urlCount || currentUrlCount;
      const activeWebhooks = webhookManager.getAllActive();
      if (activeWebhooks.length < currentUrlCount) {
        const diff = currentUrlCount - activeWebhooks.length;
        console.log(
          `[SYSTEM] Dynamic Scale-up: Generating ${diff} additional webhook(s).`
        );
        await webhookManager.generateWebhooks(diff, currentRetentionHours);
      }

      // 5. Update Retention
      currentRetentionHours = newInput.retentionHours || currentRetentionHours;
      await webhookManager.updateRetention(currentRetentionHours);

      console.log("[SYSTEM] Hot-reload complete. New settings are active.");
    } catch (err) {
      console.error(
        "[SYSTEM-ERROR] Failed to apply new settings:",
        err.message
      );
    }
  });

  sseHeartbeat = setInterval(() => {
    clients.forEach((c) => c.write(": heartbeat\n\n"));
  }, SSE_HEARTBEAT_INTERVAL_MS);
  if (sseHeartbeat.unref) sseHeartbeat.unref();

  const authMiddleware = (req, res, next) => {
    const { isValid, error } = validateAuth(req, currentAuthKey);
    if (!isValid) {
      return res.status(401).json({
        status: 401,
        error: "Unauthorized",
        message: error,
      });
    }
    next();
  };

  // --- Routes ---

  app.all(
    "/webhook/:id",
    // @ts-ignore
    (req, res, next) => {
      const statusOverride = parseInt(req.query.__status);
      if (statusOverride >= 100 && statusOverride < 600) {
        req.forcedStatus = statusOverride;
      }
      next();
    },
    // @ts-ignore
    loggerMiddleware
  );

  app.all(
    "/replay/:webhookId/:itemId",
    mgmtRateLimiter,
    authMiddleware,
    // @ts-ignore
    async (req, res) => {
      try {
        const { webhookId, itemId } = req.params;
        const targetUrl = req.query.url;
        if (!targetUrl)
          return res.status(400).json({ error: "Missing 'url' parameter" });

        const dataset = await Actor.openDataset();
        const { items } = await dataset.getData();
        // Prioritize exact ID match. Fallback to timestamp only if no ID matches.
        const item =
          items.find((i) => i.webhookId === webhookId && i.id === itemId) ||
          items.find(
            (i) => i.webhookId === webhookId && i.timestamp === itemId
          );

        if (!item) return res.status(404).json({ error: "Event not found" });

        const headersToIgnore = [
          "content-length",
          "content-encoding",
          "transfer-encoding",
          "host",
          "connection",
          "keep-alive",
          "proxy-authorization",
          "te",
          "trailer",
          "upgrade",
        ];
        const strippedHeaders = [];
        const filteredHeaders = Object.entries(item.headers || {}).reduce(
          (acc, [key, value]) => {
            const lowerKey = key.toLowerCase();
            const isMasked =
              typeof value === "string" && value.toUpperCase() === "[MASKED]";
            if (isMasked || headersToIgnore.includes(lowerKey)) {
              strippedHeaders.push(key);
            } else {
              acc[key] = value;
            }
            return acc;
          },
          {}
        );

        let attempt = 0;
        let r;
        while (attempt < MAX_REPLAY_RETRIES) {
          try {
            attempt++;
            r = await axios({
              method: item.method,
              url: String(targetUrl),
              data: item.body,
              headers: {
                ...filteredHeaders,
                "X-Apify-Replay": "true",
                "X-Original-Webhook-Id": webhookId,
                host: new URL(targetUrl).host,
              },
              validateStatus: () => true,
              timeout: REPLAY_TIMEOUT_MS,
            });
            break; // Success
          } catch (err) {
            if (
              attempt >= MAX_REPLAY_RETRIES ||
              (err.code !== "ECONNABORTED" && err.code !== "ECONNRESET")
            ) {
              throw err;
            }
            const delay = 1000 * Math.pow(2, attempt - 1);
            console.warn(
              `[REPLAY-RETRY] Attempt ${attempt}/${MAX_REPLAY_RETRIES} failed for ${targetUrl}: ${err.code}. Retrying in ${delay}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (strippedHeaders.length > 0) {
          res.setHeader(
            "X-Apify-Replay-Warning",
            `Headers stripped (masked or transmission-related): ${strippedHeaders.join(
              ", "
            )}`
          );
        }
        res.json({
          status: "Replayed",
          targetUrl,
          targetResponseCode: r.status,
          targetResponseBody: r.data,
          strippedHeaders:
            strippedHeaders.length > 0 ? strippedHeaders : undefined,
        });
      } catch (error) {
        const isTimeout = error.code === "ECONNABORTED";
        res.status(isTimeout ? 504 : 500).json({
          error: "Replay failed",
          message: isTimeout
            ? "Target destination timed out after 3 attempts and 10s timeout"
            : error.message,
          code: error.code,
        });
      }
    }
  );

  app.get("/log-stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  app.get("/logs", mgmtRateLimiter, authMiddleware, async (req, res) => {
    try {
      let {
        webhookId,
        method,
        statusCode,
        contentType,
        limit = 100,
        offset = 0,
      } = req.query;
      limit = Math.min(Math.max(parseInt(String(limit)) || 100, 1), 1000);
      offset = Math.max(parseInt(String(offset)) || 0, 0);

      const hasFilters = !!(webhookId || method || statusCode || contentType);
      const dataset = await Actor.openDataset();
      const result = await dataset.getData({
        limit: hasFilters ? limit * 5 : limit,
        offset,
        desc: true,
      });

      const filtered = (result.items || [])
        .filter((item) => {
          if (webhookId && item.webhookId !== webhookId) return false;
          if (
            method &&
            item.method?.toUpperCase() !== String(method).toUpperCase()
          )
            return false;
          if (statusCode && String(item.statusCode) !== String(statusCode))
            return false;
          if (
            contentType &&
            !item.headers?.["content-type"]?.includes(String(contentType))
          )
            return false;
          return webhookManager.isValid(item.webhookId);
        })
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

      res.json({
        filters: { webhookId, method, statusCode, contentType },
        count: Math.min(filtered.length, limit),
        total: filtered.length,
        items: filtered.slice(0, limit),
      });
    } catch (e) {
      res.status(500).json({ error: "Logs failed", message: e.message });
    }
  });

  app.get("/info", mgmtRateLimiter, authMiddleware, (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const activeWebhooks = webhookManager.getAllActive();

    res.json({
      version: "2.7.0",
      status: "Enterprise Suite Online",
      system: {
        authActive: !!authKey,
        retentionHours,
        maxPayloadLimit: `${((maxPayloadSize || 0) / 1024 / 1024).toFixed(
          1
        )}MB`,
        webhookCount: activeWebhooks.length,
        activeWebhooks,
      },
      features: [
        "Advanced Mocking & Latency Control",
        "Enterprise Security (Auth/CIDR)",
        "Smart Forwarding Workflows",
        "Isomorphic Custom Scripting",
        "Real-time SSE Log Streaming",
        "High-Performance Logging",
      ],
      endpoints: {
        logs: `${baseUrl}/logs?limit=100`,
        stream: `${baseUrl}/log-stream`,
        webhook: `${baseUrl}/webhook/:id`,
        replay: `${baseUrl}/replay/:webhookId/:itemId?url=http://your-goal.com`,
        info: `${baseUrl}/info`,
      },
      docs: "https://apify.com/ar27111994/webhook-debugger-logger",
    });
  });

  app.get("/", (req, res) => {
    // 1. Readiness Probe (Always Public)
    if (req.headers["x-apify-container-server-readiness-probe"]) {
      return res.status(200).send("OK");
    }

    const isBrowser = req.headers["accept"]?.includes("text/html");

    // 2. Auth Check for Root
    const { isValid, error } = validateAuth(req, authKey);
    if (!isValid) {
      if (isBrowser) {
        return res.status(401).send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Locked | Webhook Debugger</title>
              <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
              <style>
                  :root { --primary: #5865F2; --danger: #f87171; --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --text-dim: #94a3b8; }
                  body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
                  .container { max-width: 450px; background: var(--card); padding: 40px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                  h1 { font-weight: 800; color: var(--danger); margin: 0; font-size: 1.5rem; }
                  .lock-icon { font-size: 3rem; margin-bottom: 16px; display: block; }
                  p { color: var(--text-dim); line-height: 1.6; margin: 20px 0; }
                  .code { font-family: 'JetBrains Mono', monospace; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; font-size: 0.85rem; color: var(--primary); word-break: break-all; }
                  a { color: var(--primary); text-decoration: none; font-weight: 600; }
              </style>
          </head>
          <body>
              <div class="container">
                  <span class="lock-icon">🔒</span>
                  <h1>Access Restricted</h1>
                  <p>This Actor is running in <b>Strict Mode</b>. You must provide an <code>authKey</code> to access the management interface.</p>
                  <div class="stat-item" style="text-align:left; border-left: 4px solid var(--danger); background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px;">
                    <span style="font-size: 0.8rem; color: var(--text-dim); display: block; margin-bottom: 4px;">Error Details</span>
                    <span class="stat-value" style="color: var(--danger); font-family: 'JetBrains Mono', monospace;">${escapeHtml(
                      error
                    )}</span>
                  </div>
                  <p style="font-size: 0.85rem;">To authenticate in the browser, append <code>?key=YOUR_KEY</code> to the URL.</p>
                  <p style="margin-top:24px; font-size: 0.8rem; color: var(--text-dim);"><a href="https://apify.com/ar27111994/webhook-debugger-logger" target="_blank">View Documentation</a></p>
              </div>
          </body>
          </html>
        `);
      }
      return res.status(401).json({ error: "Unauthorized", message: error });
    }

    // 3. Authenticated View
    const activeCount = webhookManager.getAllActive().length;

    if (isBrowser) {
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Webhook Debugger v2.7.0</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
            <style>
                :root { --primary: #5865F2; --success: #2ecc71; --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --text-dim: #94a3b8; }
                body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
                .container { max-width: 600px; background: var(--card); padding: 40px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                h1 { font-weight: 800; color: var(--primary); margin: 0; }
                .version { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; color: var(--text-dim); margin: 8px 0 24px; display: block; }
                .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(46, 204, 113, 0.1); color: var(--success); padding: 8px 16px; border-radius: 99px; font-weight: 600; margin-bottom: 32px; }
                .dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite; }
                .stat-item { background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; border-left: 4px solid var(--primary); text-align: left; margin-bottom: 16px; }
                .stat-label { font-size: 0.8rem; color: var(--text-dim); display: block; margin-bottom: 4px; }
                .stat-value { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
                a { color: var(--primary); text-decoration: none; font-weight: 600; }
                @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Webhook Debugger</h1>
                <span class="version">v2.7.0 "Enterprise Suite"</span>
                <div class="status"><div class="dot"></div>System Online & Optimized</div>
                <div class="stat-item"><span class="stat-label">Active Webhooks (Live TTL)</span><span class="stat-value">${activeCount} active endpoints</span></div>
                <div class="stat-item"><span class="stat-label">Quick Start</span><span class="stat-value">GET <a href="/info">/info</a> to view routing and management APIs</span></div>
                <p style="margin-top:24px; font-size: 0.85rem; color: var(--text-dim);">Built for high-stakes launches • <a href="https://apify.com/ar27111994/webhook-debugger-logger" target="_blank">Documentation</a></p>
            </div>
        </body>
        </html>
      `);
    } else {
      res.send(
        `Webhook Debugger & Logger v2.7.0 (Enterprise Suite) is running.\nActive Webhooks: ${activeCount}\nUse /info for management API.\n`
      );
    }
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.statusCode || err.status || 500;
    res.status(status).json({
      status,
      error:
        status === 413
          ? "Payload Too Large"
          : status === 400
          ? "Bad Request"
          : "Internal Server Error",
      message: err.message,
    });
  });

  /* istanbul ignore next */
  if (process.env.NODE_ENV !== "test") {
    const port = process.env.ACTOR_WEB_SERVER_PORT || 8080;
    server = app.listen(port, () =>
      console.log(`Server listening on port ${port}`)
    );
    cleanupInterval = setInterval(
      () => webhookManager.cleanup(),
      CLEANUP_INTERVAL_MS
    );
    Actor.on("migrating", () => shutdown("MIGRATING"));
    Actor.on("aborting", () => shutdown("ABORTING"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }

  return app;
}

if (process.env.NODE_ENV !== "test") {
  /* istanbul ignore next */
  initialize().catch((err) => {
    console.error("[FATAL] Server failed to start:", err.message);
    process.exit(1);
  });
}

export { app, webhookManager, server, sseHeartbeat, initialize, shutdown };
