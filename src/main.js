import { Actor } from "apify";
import { getDbInstance } from "./db/duckdb.js";
import { SyncService } from "./services/SyncService.js";
import express from "express";
import compression from "compression";
import { WebhookManager } from "./webhook_manager.js";
import { LoggerMiddleware } from "./logger_middleware.js";
import { parseWebhookOptions, normalizeInput } from "./utils/config.js";
import { ensureLocalInputExists } from "./utils/bootstrap.js";
import { HotReloadManager } from "./utils/hot_reload_manager.js";
import { AppState } from "./utils/app_state.js";
import {
  CLEANUP_INTERVAL_MS,
  INPUT_POLL_INTERVAL_PROD_MS,
  INPUT_POLL_INTERVAL_TEST_MS,
  SHUTDOWN_TIMEOUT_MS,
  SSE_HEARTBEAT_INTERVAL_MS,
  STARTUP_TEST_EXIT_DELAY_MS,
  DEFAULT_URL_COUNT,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_PAYLOAD_LIMIT,
} from "./consts.js";
import {
  createBroadcaster,
  createLogsHandler,
  createLogDetailHandler,
  createInfoHandler,
  createLogStreamHandler,
  createReplayHandler,
  createDashboardHandler,
  preloadTemplate,
} from "./routes/index.js";
import {
  createAuthMiddleware,
  createJsonParserMiddleware,
  createRequestIdMiddleware,
  createCspMiddleware,
  createErrorHandler,
} from "./middleware/index.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import cors from "cors";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("http").Server} Server
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("./typedefs.js").CommonError} CommonError
 * @typedef {ReturnType<typeof setInterval> | undefined} Interval
 */

const INPUT_POLL_INTERVAL_MS =
  process.env.NODE_ENV === "test"
    ? INPUT_POLL_INTERVAL_TEST_MS
    : INPUT_POLL_INTERVAL_PROD_MS;

const APP_VERSION =
  process.env.npm_package_version || packageJson.version || "unknown";

/** @type {Server | undefined} */
let server;
/** @type {Interval} */
let sseHeartbeat;
/** @type {Interval} */
let cleanupInterval;
/** @type {AppState | undefined} */
let appState;
/** @type {HotReloadManager | undefined} */
let hotReloadManager;

const webhookManager = new WebhookManager();
/** @type {SyncService} */
const syncService = new SyncService();
/** @type {Set<ServerResponse>} */
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
  if (hotReloadManager) await hotReloadManager.stop();

  syncService.stop();

  if (appState) appState.destroy();

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
 * @param {Object} testOptions - Options for testing purposes.
 * @returns {Promise<import("express").Application>}
 */
// Exported for tests to allow dependency injection
export async function initialize(testOptions = {}) {
  await Actor.init();

  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Cache the HTML template once at startup (using modular preloader)
  let indexTemplate = await preloadTemplate();

  // Ensure local INPUT.json exists for better DX (when running locally/npx)
  // Only create artifact if NOT running on the Apify Platform (Stateless vs Stateful)
  // We want to preserve local artifacts for hot-reload dev workflows.
  const rawInput = /** @type {any} */ ((await Actor.getInput()) || {});
  let input = { ...rawInput, ...testOptions };

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
  const enableJSONParsing =
    config.enableJSONParsing !== undefined ? config.enableJSONParsing : true;
  const testAndExit = input.testAndExit || false;

  await webhookManager.init();

  // Initialize DB and Sync Service
  try {
    await getDbInstance();
    // Start background sync (non-blocking, but initial sync will happen)
    await syncService.start();
  } catch (err) {
    console.error("Failed to initialize DuckDB or SyncService:", err);
    // Strategy: Disposable Read Model
    // We intentionally allow the application to start even if the Read Model (DuckDB) fails.
    // The Dataset (Write Model) is the single source of truth, so ingestion remains functional.
    // Query capabilities may be unavailable, but data integrity is preserved in the Dataset.
  }

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

  // Initialize LoggerMiddleware first as it's a dependency for AppState
  const loggerMiddlewareInstance = new LoggerMiddleware(
    webhookManager,
    config,
    broadcast,
  );

  // Initialize AppState (encapsulates authKey, rateLimiter, bodyParser, etc.)
  appState = new AppState(config, webhookManager, loggerMiddlewareInstance);

  // 3. Auth Middleware (using modular factory)
  const authMiddleware = createAuthMiddleware(() => appState?.authKey || "");

  // Rate Limiter managed by AppState
  // RateLimiter is created in AppState constructor
  const mgmtRateLimiter = appState.rateLimitMiddleware;

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

  app.use(cors());

  // Dynamic Body Parser managed by AppState
  app.use(appState.bodyParserMiddleware);

  if (enableJSONParsing) {
    app.use(createJsonParserMiddleware());
  }

  // --- Hot Reloading Logic ---
  hotReloadManager = new HotReloadManager({
    initialInput: normalizeInput(input),
    pollIntervalMs: INPUT_POLL_INTERVAL_MS,
    onConfigChange: appState.applyConfigUpdate.bind(appState),
  });

  await hotReloadManager.init();
  hotReloadManager.start();

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
  app.get(
    "/",
    mgmtRateLimiter,
    authMiddleware,
    createDashboardHandler({
      webhookManager,
      version: APP_VERSION,
      getTemplate: () => indexTemplate,
      setTemplate: (template) => {
        indexTemplate = template;
      },
      getSignatureStatus: () => {
        const opts = loggerMiddlewareInstance.options.signatureVerification;
        if (opts?.provider && opts?.secret) {
          return opts.provider.toUpperCase();
        }
        return null;
      },
    }),
  );

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
    loggerMiddlewareInstance.middleware,
  );

  app.all(
    "/replay/:webhookId/:itemId",
    mgmtRateLimiter,
    authMiddleware,
    createReplayHandler(
      () => appState?.replayMaxRetries,
      () => appState?.replayTimeoutMs,
    ),
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
    "/logs/:logId",
    mgmtRateLimiter,
    authMiddleware,
    createLogDetailHandler(webhookManager),
  );

  app.get(
    "/info",
    mgmtRateLimiter,
    authMiddleware,
    createInfoHandler({
      webhookManager,
      getAuthKey: () => appState?.authKey || "",
      getRetentionHours: () =>
        appState?.retentionHours || DEFAULT_RETENTION_HOURS,
      getMaxPayloadSize: () =>
        appState?.maxPayloadSize || DEFAULT_PAYLOAD_LIMIT,
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

export { app, webhookManager, server, sseHeartbeat, shutdown };
