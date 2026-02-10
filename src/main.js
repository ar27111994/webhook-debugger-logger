/**
 * @file src/main.js
 * @description Main Entry Point. Initializes the Apify Actor, sets up the Express server,
 * configures middleware (Auth, DB, Sync), and handles graceful shutdown.
 * @module main
 */
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
  APP_CONSTS,
  ENV_VARS,
  ENV_VALUES,
  SHUTDOWN_SIGNALS,
  APP_ROUTES,
  QUERY_PARAMS,
  EXIT_CODES,
  EXPRESS_SETTINGS,
} from "./consts/app.js";
import { LOG_COMPONENTS, LOG_TAGS } from "./consts/logging.js";
import { HTTP_METHODS, HTTP_STATUS, MIME_TYPES } from "./consts/http.js";
import { STORAGE_CONSTS, FILE_NAMES } from "./consts/storage.js";
import {
  createBroadcaster,
  createLogsHandler,
  createLogDetailHandler,
  createLogPayloadHandler,
  createInfoHandler,
  createLogStreamHandler,
  createReplayHandler,
  createDashboardHandler,
  createSystemMetricsHandler,
  createHealthRoutes,
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
import { createChildLogger, serializeError } from "./utils/logger.js";
import { LOG_MESSAGES } from "./consts/messages.js";
import { validateStatusCode } from "./utils/common.js";
import { SSE_CONSTS } from "./consts/ui.js";

const log = createChildLogger({ component: LOG_COMPONENTS.MAIN });

const require = createRequire(import.meta.url);
const packageJson = require(FILE_NAMES.PACKAGE_JSON);

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").Application} Application
 * @typedef {import("http").Server} Server
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("./typedefs.js").CommonError} CommonError
 * @typedef {ReturnType<typeof setInterval> | undefined} Interval
 */

const INPUT_POLL_INTERVAL_MS =
  process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST
    ? APP_CONSTS.INPUT_POLL_INTERVAL_TEST_MS
    : APP_CONSTS.INPUT_POLL_INTERVAL_PROD_MS;

const APP_VERSION =
  process.env[ENV_VARS.NPM_PACKAGE_VERSION] ||
  packageJson.version ||
  APP_CONSTS.UNKNOWN;

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

  if (
    process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST &&
    signal !== SHUTDOWN_SIGNALS.TEST_COMPLETE
  )
    return;

  log.info({ signal }, LOG_MESSAGES.SHUTDOWN_START);
  const forceExitTimer = setTimeout(() => {
    log.error(LOG_MESSAGES.FORCE_SHUTDOWN);
    process.exit(EXIT_CODES.FAILURE);
  }, APP_CONSTS.SHUTDOWN_TIMEOUT_MS);

  const finalCleanup = async () => {
    await webhookManager.persist();
    if (process.env[ENV_VARS.NODE_ENV] !== ENV_VALUES.TEST) await Actor.exit();
    clearTimeout(forceExitTimer);
    if (process.env[ENV_VARS.NODE_ENV] !== ENV_VALUES.TEST)
      process.exit(EXIT_CODES.SUCCESS);
  };

  if (server && server.listening) {
    await new Promise((resolve) => {
      server?.close(() => resolve(undefined));
    });
    await finalCleanup();
  } else {
    await finalCleanup();
  }
};

/**
 * Handles shutdown signals with retry logic.
 * @param {string} signal - The shutdown signal.
 */
const handleShutdownSignal = (signal) => {
  let attempts = 0;
  const maxAttempts = APP_CONSTS.SHUTDOWN_RETRY_MAX_ATTEMPTS;
  const retryDelayMs = APP_CONSTS.SHUTDOWN_RETRY_DELAY_MS;

  const attemptShutdown = async () => {
    try {
      await shutdown(signal);
    } catch (error) {
      log.warn(
        { err: serializeError(error), signal, attempts },
        LOG_MESSAGES.SHUTDOWN_RETRY,
      );
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(attemptShutdown, retryDelayMs);
      } else {
        log.error(
          { err: serializeError(error), signal },
          LOG_MESSAGES.SHUTDOWN_FAILED_AFTER_RETRIES,
        );
        process.exit(EXIT_CODES.FAILURE); // Force exit if retries fail
      }
    }
  };
  attemptShutdown();
};

/**
 * Main initialization logic.
 * @param {Object} testOptions - Options for testing purposes.
 * @returns {Promise<Application>}
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
    if (process.env[ENV_VARS.INPUT]) {
      try {
        const envInput = JSON.parse(String(process.env[ENV_VARS.INPUT]));

        if (
          envInput &&
          typeof envInput === "object" &&
          !Array.isArray(envInput)
        ) {
          // Override local artifacts completely for stateless CLI usage
          input = envInput;
          log.info(LOG_MESSAGES.INPUT_ENV_VAR_PARSED);
        } else {
          throw new Error(LOG_MESSAGES.INPUT_ENV_VAR_INVALID);
        }
      } catch (e) {
        log.warn(
          { err: serializeError(e) },
          LOG_MESSAGES.INPUT_ENV_VAR_PARSE_FAILED,
        );
      }
    }
  }

  const config = parseWebhookOptions(input);
  const {
    urlCount = APP_CONSTS.DEFAULT_URL_COUNT,
    retentionHours = APP_CONSTS.DEFAULT_RETENTION_HOURS,
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
    log.error({ err: serializeError(err) }, LOG_MESSAGES.INIT_DB_SYNC_FAILED);
    // Strategy: Disposable Read Model
    // We intentionally allow the application to start even if the Read Model (DuckDB) fails.
    // The Dataset (Write Model) is the single source of truth, so ingestion remains functional.
    // Query capabilities may be unavailable, but data integrity is preserved in the Dataset.
  }

  if (process.env[ENV_VARS.NODE_ENV] !== ENV_VALUES.TEST) {
    try {
      await Actor.pushData({
        id: APP_CONSTS.STARTUP_ID_PREFIX + Date.now(),
        timestamp: new Date().toISOString(),
        method: HTTP_METHODS.SYSTEM,
        type: LOG_TAGS.STARTUP,
        body: LOG_MESSAGES.STARTUP_COMPLETE,
        statusCode: HTTP_STATUS.OK,
      });
      log.info(LOG_MESSAGES.STARTUP_COMPLETE);
    } catch (e) {
      log.warn({ err: serializeError(e) }, LOG_MESSAGES.STARTUP_LOG_FAILED);
    }
    if (testAndExit)
      setTimeout(
        () => shutdown(SHUTDOWN_SIGNALS.TESTANDEXIT),
        APP_CONSTS.STARTUP_TEST_EXIT_DELAY_MS,
      );
  }

  const active = webhookManager.getAllActive();

  // 1. Reconcile URL Count (Dynamic Scaling)
  if (active.length < urlCount) {
    const diff = urlCount - active.length;
    if (active.length === 0) {
      log.info({ count: diff }, LOG_MESSAGES.SCALING_INITIALIZING);
    } else {
      log.info({ count: diff }, LOG_MESSAGES.SCALING_UP);
    }
    await webhookManager.generateWebhooks(diff, retentionHours);
  } else if (active.length > urlCount) {
    log.info(
      { active: active.length, requested: urlCount },
      LOG_MESSAGES.SCALING_LIMIT_REACHED,
    );
  } else {
    log.info({ count: active.length }, LOG_MESSAGES.SCALING_RESUMING);
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
  // On Apify platform, trust all proxy hops (their infrastructure).
  // Self-hosted: only trust the first proxy to prevent X-Forwarded-For spoofing.
  app.set(EXPRESS_SETTINGS.TRUST_PROXY, Actor.isAtHome() ? true : 1);
  app.use(
    compression({
      filter: (req, res) => {
        if (
          req.path === APP_ROUTES.LOG_STREAM ||
          (req.headers.accept &&
            req.headers.accept.includes(MIME_TYPES.EVENT_STREAM))
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

  app.use(
    APP_ROUTES.FONTS,
    express.static(
      join(
        __dirname,
        "..",
        STORAGE_CONSTS.PUBLIC_DIR,
        STORAGE_CONSTS.FONTS_DIR_NAME,
      ),
    ),
  );

  app.use(cors());

  // Dynamic Body Parser managed by AppState
  // Crucial: Mount ingestMiddleware BEFORE body-parser to handle streams
  app.all(APP_ROUTES.WEBHOOK, loggerMiddlewareInstance.ingestMiddleware);
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
        c.write(SSE_CONSTS.HEARTBEAT_MESSAGE);
      } catch {
        clients.delete(c);
      }
    });
  }, APP_CONSTS.SSE_HEARTBEAT_INTERVAL_MS);
  if (sseHeartbeat.unref) sseHeartbeat.unref();

  // --- Routes ---
  app.get(
    APP_ROUTES.DASHBOARD,
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
    APP_ROUTES.WEBHOOK,
    (
      /** @type {Request} */ req,
      /** @type {Response} */ _res,
      /** @type {NextFunction} */ next,
    ) => {
      const statusOverride = Number.parseInt(
        /** @type {string} */ (req.query[QUERY_PARAMS.STATUS]),
        10,
      );
      if (validateStatusCode(statusOverride)) {
        /** @type {any} */ (req).forcedStatus = statusOverride;
      }
      next();
    },
    loggerMiddlewareInstance.middleware,
  );

  app.all(
    APP_ROUTES.REPLAY,
    mgmtRateLimiter,
    authMiddleware,
    createReplayHandler(
      () => appState?.replayMaxRetries,
      () => appState?.replayTimeoutMs,
    ),
  );

  app.get(
    APP_ROUTES.LOG_STREAM,
    mgmtRateLimiter,
    authMiddleware,
    createLogStreamHandler(clients),
  );

  app.get(
    APP_ROUTES.LOGS,
    mgmtRateLimiter,
    authMiddleware,
    createLogsHandler(webhookManager),
  );

  app.get(
    APP_ROUTES.LOG_DETAIL,
    mgmtRateLimiter,
    authMiddleware,
    createLogDetailHandler(webhookManager),
  );

  app.get(
    APP_ROUTES.LOG_PAYLOAD,
    mgmtRateLimiter,
    authMiddleware,
    createLogPayloadHandler(webhookManager),
  );

  app.get(
    APP_ROUTES.INFO,
    mgmtRateLimiter,
    authMiddleware,
    createInfoHandler({
      webhookManager,
      getAuthKey: () => appState?.authKey || "",
      getRetentionHours: () =>
        appState?.retentionHours || APP_CONSTS.DEFAULT_RETENTION_HOURS,
      getMaxPayloadSize: () =>
        appState?.maxPayloadSize || APP_CONSTS.DEFAULT_PAYLOAD_LIMIT,
      version: APP_VERSION,
    }),
  );

  // System metrics endpoint for monitoring
  app.get(
    APP_ROUTES.SYSTEM_METRICS,
    mgmtRateLimiter,
    authMiddleware,
    createSystemMetricsHandler(syncService),
  );

  // Health check endpoints (rate-limited but no auth required for orchestrators)
  const { health, ready } = createHealthRoutes(
    () => webhookManager.getAllActive().length,
  );
  app.get(APP_ROUTES.HEALTH, mgmtRateLimiter, health);
  app.get(APP_ROUTES.READY, mgmtRateLimiter, ready);

  // Error handling middleware (using modular factory)
  app.use(createErrorHandler());

  // -----------------------------------------------------------------------
  // 2. Constants & Configuration
  // -----------------------------------------------------------------------
  const IS_TEST = process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST;

  /* istanbul ignore next */
  if (!IS_TEST) {
    const port =
      process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT] || APP_CONSTS.DEFAULT_PORT;
    server = app.listen(port, () => {
      log.info({ port }, LOG_MESSAGES.SERVER_STARTED(Number(port)));
    });
    cleanupInterval = setInterval(() => {
      webhookManager.cleanup().catch((e) => {
        log.error({ err: serializeError(e) }, LOG_MESSAGES.CLEANUP_ERROR);
      });
    }, APP_CONSTS.CLEANUP_INTERVAL_MS);
    Actor.on("migrating", () => shutdown(SHUTDOWN_SIGNALS.MIGRATING));
    Actor.on("aborting", () => shutdown(SHUTDOWN_SIGNALS.ABORTING));

    // Refactored shutdown signals to include retry logic
    process.on(SHUTDOWN_SIGNALS.SIGTERM, () =>
      handleShutdownSignal(SHUTDOWN_SIGNALS.SIGTERM),
    );
    process.on(SHUTDOWN_SIGNALS.SIGINT, () =>
      handleShutdownSignal(SHUTDOWN_SIGNALS.SIGINT),
    );
  }

  return app;
}

if (process.env[ENV_VARS.NODE_ENV] !== ENV_VALUES.TEST) {
  initialize().catch((err) => {
    log.error({ err: serializeError(err) }, LOG_MESSAGES.SERVER_START_FAILED);
    process.exit(EXIT_CODES.FAILURE);
  });
}

export { app, webhookManager, server, sseHeartbeat, shutdown };
