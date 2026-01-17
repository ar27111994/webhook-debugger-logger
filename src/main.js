#!/usr/bin/env node

import { Actor } from "apify";
import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import { WebhookManager } from "./webhook_manager.js";
import { createLoggerMiddleware } from "./logger_middleware.js";
import {
  parseWebhookOptions,
  coerceRuntimeOptions,
  normalizeInput,
} from "./utils/config.js";
import { ensureLocalInputExists } from "./utils/bootstrap.js";
import { RateLimiter } from "./utils/rate_limiter.js";
import {
  CLEANUP_INTERVAL_MS,
  INPUT_POLL_INTERVAL_PROD_MS,
  INPUT_POLL_INTERVAL_TEST_MS,
  DEFAULT_PAYLOAD_LIMIT,
  SHUTDOWN_TIMEOUT_MS,
  SSE_HEARTBEAT_INTERVAL_MS,
  STARTUP_TEST_EXIT_DELAY_MS,
  DEFAULT_URL_COUNT,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
} from "./consts.js";
import {
  createBroadcaster,
  createLogsHandler,
  createInfoHandler,
  createLogStreamHandler,
  createReplayHandler,
  createDashboardHandler,
  preloadTemplate,
} from "./routes/index.js";
import {
  createAuthMiddleware,
  createRequestIdMiddleware,
  createCspMiddleware,
  createErrorHandler,
} from "./middleware/index.js";
import { watch as fsWatch } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
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
/** @type {AbortController | undefined} */
let fileWatcherAbortController;

const webhookManager = new WebhookManager();
/** @type {Set<import("http").ServerResponse>} */
const clients = new Set();
const app = express(); // Exported for tests

// Use factory function from routes/utils.js
const broadcast = createBroadcaster(clients);

/**
 * Gracefully shuts down the server and persists state.
 * @param {string} signal
 */
const shutdown = async (signal) => {
  if (cleanupInterval) clearInterval(cleanupInterval);
  if (sseHeartbeat) clearInterval(sseHeartbeat);
  if (inputPollInterval) clearInterval(inputPollInterval);
  if (fileWatcherAbortController) fileWatcherAbortController.abort();
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

  // Cache the HTML template once at startup (using modular preloader)
  let indexTemplate = await preloadTemplate();

  // Ensure local INPUT.json exists for better DX (when running locally/npx)
  // Only create artifact if NOT running on the Apify Platform (Stateless vs Stateful)
  // We want to preserve local artifacts for hot-reload dev workflows.
  const rawInput = /** @type {any} */ ((await Actor.getInput()) || {});
  let input = rawInput;

  if (!Actor.isAtHome()) {
    await ensureLocalInputExists(rawInput);

    // FORCE override from process.env.INPUT if present (CLI usage)
    // Apify SDK prioritizes local storage file over Env Var if the file exists.
    // We want the reverse for CLI usage (npx webhook-debugger-logger).
    if (process.env.INPUT) {
      try {
        const envInput = JSON.parse(process.env.INPUT);

        if (
          envInput &&
          typeof envInput === "object" &&
          !Array.isArray(envInput)
        ) {
          // Override local artifacts completely for stateless CLI usage
          input = envInput;
          console.log(
            "[SYSTEM] Using override from INPUT environment variable.",
          );
        } else {
          throw new Error("INPUT env var must be a non-array JSON object");
        }
      } catch (e) {
        console.warn(
          "[SYSTEM] Failed to parse INPUT env var:",
          /** @type {Error} */ (e).message,
        );
      }
    }
  }

  const config = parseWebhookOptions(input);
  const {
    urlCount = DEFAULT_URL_COUNT,
    retentionHours = DEFAULT_RETENTION_HOURS,
  } = config; // Uses coerced defaults via config.js (which we updated)
  const maxPayloadSize = config.maxPayloadSize || DEFAULT_PAYLOAD_LIMIT; // 10MB default limit for body parsing
  const enableJSONParsing =
    config.enableJSONParsing !== undefined ? config.enableJSONParsing : true;
  const authKey = config.authKey || "";
  const rateLimitPerMinute = Math.max(
    1,
    Math.floor(config.rateLimitPerMinute || DEFAULT_RATE_LIMIT_PER_MINUTE),
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
    if (active.length === 0) {
      console.log(`[SYSTEM] Initializing ${diff} webhook(s)...`);
    } else {
      console.log(
        `[SYSTEM] Scaling up: Generating ${diff} additional webhook(s).`,
      );
    }
    await webhookManager.generateWebhooks(diff, retentionHours);
  } else if (active.length > urlCount) {
    console.log(
      `[SYSTEM] Notice: Active webhooks (${active.length}) exceed requested count (${urlCount}). No new IDs generated.`,
    );
  } else {
    console.log(`[SYSTEM] Resuming with ${active.length} active webhooks.`);
  }

  // 2. Sync Retention (Global Extension)
  await webhookManager.updateRetention(retentionHours);

  // 3. Auth Middleware (using modular factory)
  const authMiddleware = createAuthMiddleware(() => currentAuthKey);

  // --- Express Middleware ---
  app.set("trust proxy", true);
  app.use(
    compression({
      filter: (req, res) => {
        if (
          req.path === "/log-stream" ||
          (req.headers.accept &&
            req.headers.accept.includes("text/event-stream"))
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  // Request ID middleware for tracing (using modular factory)
  app.use(createRequestIdMiddleware());

  // CSP Headers for dashboard security (using modular factory)
  app.use(createCspMiddleware());

  app.use("/fonts", express.static(join(__dirname, "..", "public", "fonts")));

  app.get(
    "/",
    authMiddleware,
    createDashboardHandler({
      webhookManager,
      version: APP_VERSION,
      getTemplate: () => indexTemplate,
      setTemplate: (template) => {
        indexTemplate = template;
      },
    }),
  );

  app.use(cors());

  let currentMaxPayloadSize = maxPayloadSize;
  let currentAuthKey = authKey;
  let currentRetentionHours = retentionHours;
  let currentUrlCount = urlCount;

  /** @type {import('express').Handler} */
  let currentBodyParser = bodyParser.raw({
    limit: currentMaxPayloadSize ?? DEFAULT_PAYLOAD_LIMIT,
    type: "*/*",
  });

  app.use((req, res, next) => currentBodyParser(req, res, next));

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

  webhookRateLimiter = new RateLimiter(
    rateLimitPerMinute,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  const mgmtRateLimiter = webhookRateLimiter.middleware();
  const loggerMiddleware = createLoggerMiddleware(
    webhookManager,
    config,
    broadcast,
  );

  // --- Hot Reloading Logic ---
  // Use KV Store directly to bypass local cache and enable platform hot-reload
  const store = await Actor.openKeyValueStore();
  // Sync initial state with storage (which might have been normalized by bootstrap)
  // to prevent immediate "fake" hot-reload triggers due to type coercion (e.g. "5" vs 5).
  const initialStoreValue = await store.getValue("INPUT");
  const normalizedInitialInput = normalizeInput(initialStoreValue, input);
  let lastInputStr = JSON.stringify(normalizedInitialInput);

  /**
   * Shared hot-reload handler for both fs.watch and polling
   */
  const handleHotReload = async () => {
    if (activePollPromise) return;

    activePollPromise = (async () => {
      try {
        const newInput = /** @type {Record<string, any> | null} */ (
          await store.getValue("INPUT")
        );
        if (!newInput) return;

        // Normalize input if it's a string (fixes hot-reload from raw KV updates)
        const normalizedInput = normalizeInput(newInput);

        const newInputStr = JSON.stringify(normalizedInput);
        if (newInputStr === lastInputStr) return;

        lastInputStr = newInputStr;
        console.log("[SYSTEM] Detected input update! Applying new settings...");

        // Use shared coercion logic
        const validated = coerceRuntimeOptions(normalizedInput);

        // 1. Update Middleware (response codes, delays, headers, forwarding)
        loggerMiddleware.updateOptions(normalizedInput);
        currentMaxPayloadSize = validated.maxPayloadSize;

        // 2. Update Rate Limiter
        const newRateLimit = validated.rateLimitPerMinute;
        if (webhookRateLimiter) webhookRateLimiter.limit = newRateLimit;

        // 3. Update Auth Key
        currentAuthKey = validated.authKey;

        // 4. Re-reconcile URL count
        currentUrlCount = validated.urlCount;
        const activeWebhooks = webhookManager.getAllActive();
        if (activeWebhooks.length < currentUrlCount) {
          const diff = currentUrlCount - activeWebhooks.length;
          console.log(
            `[SYSTEM] Dynamic Scale-up: Generating ${diff} additional webhook(s).`,
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
          /** @type {Error} */ (err).message,
        );
      } finally {
        activePollPromise = null;
      }
    })();

    await activePollPromise;
  };

  // Use fs.watch for instant hot-reload in local development
  if (!Actor.isAtHome()) {
    const localInputPath = join(
      process.cwd(),
      "storage",
      "key_value_stores",
      "default",
      "INPUT.json",
    );

    if (existsSync(localInputPath)) {
      console.log(
        "[SYSTEM] Local mode detected. Using fs.watch for instant hot-reload.",
      );

      fileWatcherAbortController = new AbortController();
      let debounceTimer =
        /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);

      // Start watching in background (non-blocking)
      (async () => {
        try {
          const watcher = fsWatch(localInputPath, {
            signal: fileWatcherAbortController.signal,
          });
          for await (const event of watcher) {
            if (event.eventType === "change") {
              // Debounce rapid file changes (editors often write multiple times)
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                handleHotReload().catch((err) => {
                  console.error(
                    "[SYSTEM-ERROR] fs.watch hot-reload failed:",
                    err.message,
                  );
                });
              }, 100);
            }
          }
        } catch (err) {
          const error = /** @type {CommonError} */ (err);
          if (error.name !== "AbortError") {
            console.error("[SYSTEM-ERROR] fs.watch failed:", error.message);
          }
        }
      })();
    }
  }

  // Fallback to interval polling (works on platform and as backup for local)
  inputPollInterval = setInterval(() => {
    handleHotReload().catch((err) => {
      console.error("[SYSTEM-ERROR] Polling hot-reload failed:", err.message);
    });
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
  app.all(
    "/webhook/:id",
    (
      /** @type {Request} */ req,
      /** @type {Response} */ _res,
      /** @type {NextFunction} */ next,
    ) => {
      const statusOverride = Number.parseInt(
        /** @type {string} */ (req.query.__status),
        10,
      );
      if (statusOverride >= 100 && statusOverride < 600) {
        /** @type {any} */ (req).forcedStatus = statusOverride;
      }
      next();
    },
    // @ts-expect-error - LoggerMiddleware has updateOptions attached, Express overloads don't recognize intersection types
    loggerMiddleware,
  );

  app.all(
    "/replay/:webhookId/:itemId",
    mgmtRateLimiter,
    authMiddleware,
    createReplayHandler(),
  );

  app.get(
    "/log-stream",
    mgmtRateLimiter,
    authMiddleware,
    createLogStreamHandler(clients),
  );

  app.get(
    "/logs",
    mgmtRateLimiter,
    authMiddleware,
    createLogsHandler(webhookManager),
  );

  app.get(
    "/info",
    mgmtRateLimiter,
    authMiddleware,
    createInfoHandler({
      webhookManager,
      getAuthKey: () => currentAuthKey,
      getRetentionHours: () => currentRetentionHours,
      getMaxPayloadSize: () => currentMaxPayloadSize,
      version: APP_VERSION,
    }),
  );

  // Error handling middleware (using modular factory)
  app.use(createErrorHandler());

  /* istanbul ignore next */
  if (process.env.NODE_ENV !== "test") {
    const port = process.env.ACTOR_WEB_SERVER_PORT || 8080;
    server = app.listen(port, () =>
      console.log(`Server listening on port ${port}`),
    );
    cleanupInterval = setInterval(() => {
      webhookManager.cleanup().catch((e) => {
        console.error("[CLEANUP-ERROR]", e?.message || e);
      });
    }, CLEANUP_INTERVAL_MS);
    Actor.on("migrating", () => shutdown("MIGRATING"));
    Actor.on("aborting", () => shutdown("ABORTING"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }

  return app;
}

if (process.env.NODE_ENV !== "test") {
  initialize().catch((err) => {
    console.error("[FATAL] Server failed to start:", err.message);
    process.exit(1);
  });
}

export { app, webhookManager, server, sseHeartbeat, initialize, shutdown };
