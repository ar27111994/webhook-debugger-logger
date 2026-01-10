import { Actor } from "apify";
import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import axios from "axios";
import { validateUrlForSsrf } from "./utils/ssrf.js";
import { WebhookManager } from "./webhook_manager.js";
import { createLoggerMiddleware } from "./logger_middleware.js";
import { parseWebhookOptions } from "./utils/config.js";
import { validateAuth } from "./utils/auth.js";
import { RateLimiter } from "./utils/rate_limiter.js";
import {
  CLEANUP_INTERVAL_MS,
  INPUT_POLL_INTERVAL_PROD_MS,
  INPUT_POLL_INTERVAL_TEST_MS,
  BODY_PARSER_SIZE_LIMIT,
  MAX_REPLAY_RETRIES,
  REPLAY_HEADERS_TO_IGNORE,
  REPLAY_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  SSE_HEARTBEAT_INTERVAL_MS,
  STARTUP_TEST_EXIT_DELAY_MS,
} from "./consts.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";
import { createRequire } from "module";
import cors from "cors";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */
/** @typedef {import("express").NextFunction} NextFunction */
/**@typedef {import("./typedefs.js").CommonError} CommonError */
/**@typedef {ReturnType<typeof setInterval> | undefined} Interval */

const INPUT_POLL_INTERVAL_MS =
  process.env.NODE_ENV === "test"
    ? INPUT_POLL_INTERVAL_TEST_MS
    : INPUT_POLL_INTERVAL_PROD_MS;

const APP_VERSION =
  process.env.npm_package_version || packageJson.version || "unknown";

/** @type {import("http").Server | undefined} */
let server;
/** @type {Interval} */
let sseHeartbeat;
/** @type {Interval} */
let inputPollInterval;
/** @type {Promise<void> | null} */
let activePollPromise = null;
/** @type {Interval} */
let cleanupInterval;
/** @type {RateLimiter | undefined} */
let webhookRateLimiter;

const webhookManager = new WebhookManager();
/** @type {Set<import("http").ServerResponse>} */
const clients = new Set();
const app = express(); // Exported for tests

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
  clients.forEach((client) => {
    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }
  });
};

/**
 * Gracefully shuts down the server and persists state.
 * @param {string} signal
 */
const shutdown = async (signal) => {
  if (cleanupInterval) clearInterval(cleanupInterval);
  if (sseHeartbeat) clearInterval(sseHeartbeat);
  if (inputPollInterval) clearInterval(inputPollInterval);
  if (activePollPromise) await activePollPromise;
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

  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Cache the HTML template once at startup
  let indexTemplate = "";
  try {
    indexTemplate = await readFile(
      join(__dirname, "..", "public", "index.html"),
      "utf-8"
    );
  } catch (err) {
    console.warn("Failed to preload index.html:", err);
  }

  const input = /** @type {any} */ ((await Actor.getInput()) || {});
  const config = parseWebhookOptions(input);
  const { urlCount, retentionHours } = config; // Uses coerced defaults via config.js (which we updated)
  const maxPayloadSize = config.maxPayloadSize || BODY_PARSER_SIZE_LIMIT; // 10MB limit for body parsing
  const enableJSONParsing =
    config.enableJSONParsing !== undefined ? config.enableJSONParsing : true;
  const authKey = config.authKey || "";
  const rateLimitPerMinute = Math.max(
    1,
    Math.floor(config.rateLimitPerMinute || 60)
  );
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
      console.warn("Startup log failed:", /** @type {Error} */ (e).message);
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

  // 3. Auth Middleware (Moved up for hoisting)
  /**
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  const authMiddleware = (req, res, next) => {
    // Bypass for readiness probe
    if (req.headers["x-apify-container-server-readiness-probe"]) {
      res.status(200).send("OK");
      return;
    }

    const authResult = validateAuth(req, currentAuthKey);

    if (!authResult.isValid) {
      // Return HTML for browsers
      if (req.headers["accept"]?.includes("text/html")) {
        res.status(401).send(`
          <!DOCTYPE html>
          <html>
            <head><title>Access Restricted</title></head>
            <body>
              <h1>Access Restricted</h1>
              <p>Strict Mode enabled.</p>
              <p>${escapeHtml(authResult.error || "Unauthorized")}</p>
            </body>
          </html>
        `);
        return;
      }

      return res.status(401).json({
        status: 401,
        error: "Unauthorized",
        message: authResult.error,
      });
    }
    next();
  };

  // --- Express Middleware ---
  app.set("trust proxy", true);
  app.use(compression());

  app.use("/fonts", express.static(join(__dirname, "..", "public", "fonts")));

  app.get("/", authMiddleware, async (req, res) => {
    if (req.headers["accept"]?.includes("text/plain")) {
      return res.send("Webhook Debugger & Logger - Enterprise Suite");
    }

    try {
      if (!indexTemplate) {
        indexTemplate = await readFile(
          join(__dirname, "..", "public", "index.html"),
          "utf-8"
        );
      }
      const activeCount = webhookManager.getAllActive().length;
      const html = indexTemplate
        .replace("{{VERSION}}", `v${APP_VERSION}`)
        .replace("{{ACTIVE_COUNT}}", String(activeCount));

      res.send(html);
    } catch (err) {
      console.error("[SERVER-ERROR] Failed to load index.html:", err);
      res.status(500).send("Internal Server Error");
    }
  });

  app.use(cors());

  app.use(bodyParser.raw({ limit: maxPayloadSize, type: "*/*" }));

  if (enableJSONParsing) {
    app.use((req, _res, next) => {
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
    config,
    broadcast
  );

  // --- Hot Reloading Logic ---
  let lastInputStr = JSON.stringify(input);

  inputPollInterval = setInterval(() => {
    if (activePollPromise) return;

    activePollPromise = (async () => {
      try {
        const newInput = /** @type {Record<string, any> | null} */ (
          await Actor.getInput()
        );
        if (!newInput) return;

        const newInputStr = JSON.stringify(newInput);
        if (newInputStr === lastInputStr) return;

        lastInputStr = newInputStr;
        console.log("[SYSTEM] Detected input update! Applying new settings...");

        // Use shared coercion logic
        const { coerceRuntimeOptions } = await import("./utils/config.js");
        const validated = coerceRuntimeOptions(newInput);

        const newConfig = parseWebhookOptions(newInput);
        const newRateLimit = validated.rateLimitPerMinute;

        // 1. Update Middleware
        loggerMiddleware.updateOptions({ ...newConfig, maxPayloadSize });

        // 2. Update Rate Limiter
        if (webhookRateLimiter) webhookRateLimiter.limit = newRateLimit;

        // 3. Update Auth Key
        currentAuthKey = validated.authKey;

        // 4. Re-reconcile URL count
        currentUrlCount = validated.urlCount;
        const activeWebhooks = webhookManager.getAllActive();
        if (activeWebhooks.length < currentUrlCount) {
          const diff = currentUrlCount - activeWebhooks.length;
          console.log(
            `[SYSTEM] Dynamic Scale-up: Generating ${diff} additional webhook(s).`
          );
          await webhookManager.generateWebhooks(diff, currentRetentionHours);
        }

        // 5. Update Retention
        currentRetentionHours = validated.retentionHours;
        await webhookManager.updateRetention(currentRetentionHours);

        console.log("[SYSTEM] Hot-reload complete. New settings are active.");
      } catch (err) {
        console.error(
          "[SYSTEM-ERROR] Failed to apply new settings:",
          /** @type {Error} */ (err).message
        );
      } finally {
        activePollPromise = null;
      }
    })();
  }, INPUT_POLL_INTERVAL_MS);
  if (inputPollInterval.unref) inputPollInterval.unref();

  sseHeartbeat = setInterval(() => {
    clients.forEach((c) => {
      try {
        c.write(": heartbeat\n\n");
      } catch {
        clients.delete(c);
      }
    });
  }, SSE_HEARTBEAT_INTERVAL_MS);
  if (sseHeartbeat.unref) sseHeartbeat.unref();

  // --- Routes ---

  /**
   * Wraps an async handler to be compatible with Express RequestHandler.
   * @param {(req: Request, res: Response, next: NextFunction) => Promise<void>} fn
   * @returns {import("express").RequestHandler}
   */
  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  app.all(
    "/webhook/:id",
    (
      /** @type {Request} */ req,
      /** @type {Response} */ _res,
      /** @type {NextFunction} */ next
    ) => {
      const statusOverride = parseInt(
        /** @type {string} */ (req.query.__status)
      );
      if (statusOverride >= 100 && statusOverride < 600) {
        /** @type {any} */ (req).forcedStatus = statusOverride;
      }
      next();
    },
    // @ts-expect-error - LoggerMiddleware has updateOptions attached, Express overloads don't recognize intersection types
    loggerMiddleware
  );

  app.all(
    "/replay/:webhookId/:itemId",
    mgmtRateLimiter,
    authMiddleware,
    asyncHandler(async (req, res) => {
      try {
        const { webhookId, itemId } = req.params;
        let targetUrl = req.query.url;
        if (Array.isArray(targetUrl)) {
          targetUrl = targetUrl[0];
        }
        if (!targetUrl) {
          res.status(400).json({ error: "Missing 'url' parameter" });
          return;
        }

        // Validate URL and check for SSRF
        // Use normalized targetUrl for validation
        const ssrfResult = await validateUrlForSsrf(String(targetUrl));
        if (!ssrfResult.safe) {
          if (ssrfResult.error === "Unable to resolve hostname") {
            res
              .status(400)
              .json({ error: "Unable to resolve hostname for 'url'" });
            return;
          }
          if (ssrfResult.error === "DNS resolution failed") {
            res.status(400).json({
              error: "Unable to validate 'url' parameter (DNS failure)",
            });
            return;
          }
          res.status(400).json({ error: ssrfResult.error });
          return;
        }

        const target = {
          href: ssrfResult.href,
          host: ssrfResult.host,
        };

        const dataset = await Actor.openDataset();
        const { items } = await dataset.getData();
        // Prioritize exact ID match. Fallback to timestamp only if no ID matches.
        const item =
          items.find((i) => i.webhookId === webhookId && i.id === itemId) ||
          items.find(
            (i) => i.webhookId === webhookId && i.timestamp === itemId
          );

        if (!item) {
          res.status(404).json({ error: "Event not found" });
          return;
        }

        const headersToIgnore = REPLAY_HEADERS_TO_IGNORE;
        /** @type {string[]} */
        const strippedHeaders = [];
        /** @type {Record<string, unknown>} */
        const filteredHeaders = Object.entries(item.headers || {}).reduce(
          (/** @type {Record<string, unknown>} */ acc, [key, value]) => {
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
        /** @type {import("axios").AxiosResponse | undefined} */
        let r;
        while (attempt < MAX_REPLAY_RETRIES) {
          try {
            attempt++;
            r = await axios({
              method: item.method,
              url: target.href,
              data: item.body,
              headers: {
                ...filteredHeaders,
                "X-Apify-Replay": "true",
                "X-Original-Webhook-Id": webhookId,
                host: target.host,
              },
              maxRedirects: 0,
              validateStatus: () => true,
              timeout: REPLAY_TIMEOUT_MS,
            });
            break; // Success
          } catch (err) {
            const axiosError = /** @type {CommonError} */ (err);
            const retryableErrors = [
              "ECONNABORTED",
              "ECONNRESET",
              "ETIMEDOUT",
              "ENOTFOUND",
              "EAI_AGAIN",
            ];
            if (
              attempt >= MAX_REPLAY_RETRIES ||
              !retryableErrors.includes(axiosError.code || "")
            ) {
              throw err;
            }
            const delay = 1000 * Math.pow(2, attempt - 1);
            console.warn(
              `[REPLAY-RETRY] Attempt ${attempt}/${MAX_REPLAY_RETRIES} failed for ${target.href}: ${axiosError.code}. Retrying in ${delay}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (!r) {
          res.status(504).json({
            error: "Replay failed",
            message: `All ${MAX_REPLAY_RETRIES} retry attempts exhausted`,
          });
          return;
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
          targetResponseCode: r?.status,
          targetResponseBody: r?.data,
          strippedHeaders:
            strippedHeaders.length > 0 ? strippedHeaders : undefined,
        });
      } catch (error) {
        const axiosError = /** @type {CommonError} */ (error);
        const isTimeout =
          axiosError.code === "ECONNABORTED" || axiosError.code === "ETIMEDOUT";
        res.status(isTimeout ? 504 : 500).json({
          error: "Replay failed",
          message: isTimeout
            ? `Target destination timed out after ${MAX_REPLAY_RETRIES} attempts (${
                REPLAY_TIMEOUT_MS / 1000
              }s timeout per attempt)`
            : axiosError.message,
          code: axiosError.code,
        });
      }
    })
  );

  app.get("/log-stream", mgmtRateLimiter, authMiddleware, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  app.get(
    "/logs",
    mgmtRateLimiter,
    authMiddleware,
    asyncHandler(async (req, res) => {
      try {
        let {
          webhookId,
          method,
          statusCode,
          contentType,
          limit = 100,
          offset = 0,
        } = req.query;
        limit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 1000);
        offset = Math.max(parseInt(String(offset), 10) || 0, 0);

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
        return;
      } catch (e) {
        res.status(500).json({
          error: "Logs failed",
          message: /** @type {Error} */ (e).message,
        });
      }
    })
  );

  app.get("/info", mgmtRateLimiter, authMiddleware, (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const activeWebhooks = webhookManager.getAllActive();

    res.json({
      version: APP_VERSION,
      status: "Enterprise Suite Online",
      system: {
        authActive: !!currentAuthKey,
        retentionHours: currentRetentionHours,
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

  /**
   * Error handling middleware
   * @param {CommonError} err
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  app.use(
    /**
     * @param {CommonError} err
     * @param {Request} _req
     * @param {Response} res
     * @param {NextFunction} next
     */
    (err, _req, res, next) => {
      if (res.headersSent) return next(err);
      const status = err.statusCode || err.status || 500;
      // Sanitize: don't leak internal error details for 500-level errors
      const isServerError = status >= 500;
      if (isServerError) {
        console.error("[SERVER-ERROR]", err.stack || err.message || err);
      }
      res.status(status).json({
        status,
        error:
          status === 413
            ? "Payload Too Large"
            : status === 400
            ? "Bad Request"
            : "Internal Server Error",
        message: isServerError ? "Internal Server Error" : err.message,
      });
    }
  );

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
