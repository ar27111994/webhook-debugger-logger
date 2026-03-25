/**
 * @file src/main.js
 * @description Main Entry Point. Initializes the Apify Actor, sets up the Express server,
 * configures middleware (Auth, DB, Sync), and handles graceful shutdown.
 * @module main
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
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
  SHUTDOWN_SIGNALS,
  APP_ROUTES,
  QUERY_PARAMS,
  EXIT_CODES,
  EXPRESS_SETTINGS,
} from "./consts/app.js";
import { LOG_COMPONENTS, LOG_TAGS } from "./consts/logging.js";
import {
  ENCODINGS,
  HTTP_METHODS,
  HTTP_STATUS,
  MIME_TYPES,
} from "./consts/http.js";
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
import cors from "cors";
import { createChildLogger, serializeError } from "./utils/logger.js";
import { LOG_MESSAGES } from "./consts/messages.js";
import { validateStatusCode } from "./utils/common.js";
import { SSE_CONSTS } from "./consts/ui.js";
import { exit as systemExit, on as systemOn } from "./utils/system.js";
import { ERROR_MESSAGES } from "./consts/errors.js";
import { IS_TEST } from "./utils/env.js";

const log = createChildLogger({ component: LOG_COMPONENTS.MAIN });

// Single __dirname declaration at module scope; the inner shadow inside
// initialize() has been removed — both resolve to the same value.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Wrap readFileSync so a missing or malformed package.json does not
// prevent the entire module from loading. APP_VERSION falls back gracefully.
let packageJson = /** @type {{ version?: string }} */ ({});
try {
  packageJson = JSON.parse(
    readFileSync(join(__dirname, FILE_NAMES.PACKAGE_JSON), ENCODINGS.UTF),
  );
} catch {
  // package.json absent or malformed — APP_VERSION falls through to APP_CONSTS.UNKNOWN
}

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").Application} Application
 * @typedef {import("http").Server} Server
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("./typedefs.js").CommonError} CommonError
 * @typedef {import("./typedefs.js").CustomRequest} CustomRequest
 * @typedef {import("./typedefs.js").ActorInput} ActorInput
 * @typedef {ReturnType<typeof setInterval> | undefined} Interval
 */

/**
 * The interval at which the input is polled for changes.
 * Evaluated lazily inside initialize() to support dynamic environment switching.
 * 
 * @type {number}
 */
let inputPollIntervalMs;

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

// Track initialization to detect re-entrancy and enable safe teardown
// of leaked intervals and managers on a second call.
let isInitialized = false;

const webhookManager = new WebhookManager();
/** @type {SyncService} */
const syncService = new SyncService();
/** @type {Set<ServerResponse>} */
const clients = new Set();
const app = express();

const broadcast = createBroadcaster(clients);
let isShuttingDown = false;
let signalsRegistered = false;

/**
 * Gracefully shuts down the server and persists state.
 * @param {string} signal
 */
const shutdown = async (signal) => {
  log.info({ signal }, LOG_MESSAGES.SHUTDOWN_START);
  const forceExitTimer = setTimeout(() => {
    log.error(LOG_MESSAGES.FORCE_SHUTDOWN);
    systemExit(EXIT_CODES.FAILURE);
  }, APP_CONSTS.SHUTDOWN_TIMEOUT_MS);

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  }
  if (sseHeartbeat) {
    clearInterval(sseHeartbeat);
    sseHeartbeat = undefined;
  }

  // Signal all open SSE streams to close before draining the server so
  // clients are not left hanging on a silently abandoned connection.
  clients.forEach((c) => {
    try {
      c.end();
    } catch {
      /* ignore — client may already be gone */
    }
  });
  clients.clear();

  if (hotReloadManager) {
    try {
      await hotReloadManager.stop();
    } catch (err) {
      log.warn(
        { err: serializeError(err) },
        LOG_MESSAGES.SHUTDOWN_HOT_RELOAD_FAILED,
      );
    }
  }

  if (appState) {
    try {
      appState.destroy();
    } catch (err) {
      log.warn(
        { err: serializeError(err) },
        LOG_MESSAGES.SHUTDOWN_APP_STATE_FAILED,
      );
    }
  }

  // Stop Database sync service
  // Don't wrap it → a stop() failure retries the whole shutdown sequence,
  // which is what we want.
  await syncService.stop();

  if (IS_TEST() && signal !== SHUTDOWN_SIGNALS.TEST_COMPLETE) {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    return;
  }

  const finalCleanup = async () => {
    try {
      await webhookManager.persist();
      // Actor.exit() calls process.exit() internally, making the systemExit
      // below dead code on the happy path. It is an explicit last-resort fallback for
      // the case where the Apify SDK throws instead of exiting (e.g. a future SDK bug).
      if (!IS_TEST()) await Actor.exit();
    } catch (err) {
      log.warn(
        { err: serializeError(err) },
        LOG_MESSAGES.SHUTDOWN_FINAL_CLEANUP_FAILED,
      );
    } finally {
      clearTimeout(forceExitTimer);
      // Fallback: only reached if Actor.exit() threw, or in test mode.
      if (!IS_TEST()) systemExit(EXIT_CODES.SUCCESS);
    }
  };

  if (server && server.listening) {
    // Drain existing keep-alive connections so server.close() fires promptly
    // rather than waiting for each client to disconnect on its own.
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
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
 * @param {string} signal
 */
const handleShutdownSignal = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

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
        systemExit(EXIT_CODES.FAILURE);
      }
    }
  };
  attemptShutdown();
};

/**
 * Resets shutdown and initialization state for testing purposes.
 * @internal
 */
const resetShutdownForTest = () => {
  isShuttingDown = false;
  signalsRegistered = false;
  // Also reset the init guard so tests can call initialize() across
  // a shutdown→reset→initialize cycle without triggering the re-entrancy warning.
  isInitialized = false;
  hotReloadManager = undefined;
  appState = undefined;
  sseHeartbeat = undefined;
  cleanupInterval = undefined;
};

/**
 * Registers handlers for termination signals and platform events.
 * @internal
 */
const setupGracefulShutdown = () => {
  if (signalsRegistered) return;
  signalsRegistered = true;

  [SHUTDOWN_SIGNALS.SIGTERM, SHUTDOWN_SIGNALS.SIGINT].forEach((sig) => {
    systemOn(sig, () => handleShutdownSignal(sig));
  });

  Actor.on("migrating", () => handleShutdownSignal(SHUTDOWN_SIGNALS.MIGRATING));
  Actor.on("aborting", () => handleShutdownSignal(SHUTDOWN_SIGNALS.ABORTING));
};

/**
 * Main initialization logic.
 * @param {Partial<ActorInput>} testOptions - Options for testing purposes.
 * @returns {Promise<Application>}
 */
async function initialize(testOptions = {}) {
  // On re-entrancy, clear leaked resources from the previous call before
  // proceeding. This prevents orphaned intervals and file watchers accumulating when
  // initialize() is called more than once without an intervening shutdown().
  if (isInitialized) {
    log.warn(LOG_MESSAGES.ALREADY_INITIALIZED);
    if (sseHeartbeat) clearInterval(sseHeartbeat);
    if (cleanupInterval) clearInterval(cleanupInterval);
    if (hotReloadManager) {
      await hotReloadManager.stop().catch((err) => {
        log.warn(
          { err: serializeError(err) },
          LOG_MESSAGES.HOT_RELOAD_STOP_FAILED,
        );
      });
    }
    return app;
  }
  isInitialized = true;

  // Initialize poll interval based on current environment
  inputPollIntervalMs = IS_TEST()
    ? APP_CONSTS.INPUT_POLL_INTERVAL_TEST_MS
    : APP_CONSTS.INPUT_POLL_INTERVAL_PROD_MS;

  await Actor.init();
  setupGracefulShutdown();

  // Cache the HTML template once at startup (using modular preloader)
  let indexTemplate = await preloadTemplate();

  // Ensure local INPUT.json exists for better DX (when running locally/npx)
  // Only create artifact if NOT running on the Apify Platform (Stateless vs Stateful)
  // We want to preserve local artifacts for hot-reload dev workflows.
  /** @type {ActorInput} */
  const rawInput = (await Actor.getInput()) || {};
  /** @type {ActorInput} */
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
  const urlCount = /** @type {number} */ (config.urlCount);
  const retentionHours = /** @type {number} */ (config.retentionHours);
  const enableJSONParsing = /** @type {boolean} */ (config.enableJSONParsing);
  const testAndExit = input.testAndExit || false;

  await webhookManager.init();

  // Initialize DB and Sync Service
  try {
    await getDbInstance();
    // Start background sync (non-blocking, but initial sync will happen)
    await syncService.start();
  } catch (err) {
    log.error({ err: serializeError(err) }, LOG_MESSAGES.INIT_DB_SYNC_FAILED);
    // Strategy: Disposable Read Model — allow the application to start even when
    // DuckDB fails. The Dataset is the source of truth; ingest stays functional.
  }

  if (!IS_TEST()) {
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
  }

  // testAndExit is checked independently of IS_TEST so it can be
  // exercised in tests by passing { testAndExit: true } to initialize().
  if (testAndExit) {
    setTimeout(() => {
      shutdown(SHUTDOWN_SIGNALS.TESTANDEXIT).catch((retryErr) => {
        log.error(
          { err: retryErr, signal: SHUTDOWN_SIGNALS.TESTANDEXIT },
          ERROR_MESSAGES.SHUTDOWN_RETRY_FAILED,
        );
        systemExit(EXIT_CODES.FAILURE);
      });
    }, APP_CONSTS.STARTUP_TEST_EXIT_DELAY_MS);
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

  // Only extend retention for pre-existing webhooks loaded from KVS state.
  // Newly generated webhooks already have the correct expiresAt, so skipping the
  // call when there are none avoids a redundant KVS persist on every cold start.
  // Note: updateRetention intentionally only EXTENDS expiry, never shrinks it.
  // A user reducing retentionHours will see pre-existing webhooks keep their longer
  // expiry — this prevents accidental data loss but should be surfaced in docs.
  if (active.length > 0) {
    await webhookManager.updateRetention(retentionHours);
  }

  // LoggerMiddleware: Handles request and response processing, logging, and signature verification
  // Initialize LoggerMiddleware first as it's a dependency for AppState
  const loggerMiddlewareInstance = new LoggerMiddleware(
    webhookManager,
    config,
    broadcast,
  );

  // Initialize AppState (encapsulates authKey, rateLimiter, bodyParser, etc.)
  appState = new AppState(config, webhookManager, loggerMiddlewareInstance);

  // Auth middleware for protected routes (dashboard, logs, replay, etc.)
  const authMiddleware = createAuthMiddleware(() => appState?.authKey || "");

  // This rate limiter applies to management/read endpoints only (dashboard, logs, replay …),
  // not to the webhook ingest path which is intentionally unlimited.
  const managementRateLimiter = appState.rateLimitMiddleware;

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

  // eslint-disable-next-line sonarjs/cors
  app.use(cors());

  // Crucial: Mount ingestMiddleware BEFORE body-parser to handle streams
  app.all(APP_ROUTES.WEBHOOK, loggerMiddlewareInstance.ingestMiddleware);
  // Dynamic Body Parser managed by AppState
  app.use(appState.bodyParserMiddleware);

  if (enableJSONParsing) {
    app.use(createJsonParserMiddleware());
  }

  // --- Hot Reloading Logic ---
  hotReloadManager = new HotReloadManager({
    initialInput: normalizeInput(input),
    pollIntervalMs: inputPollIntervalMs,
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
  if (sseHeartbeat && sseHeartbeat.unref) sseHeartbeat.unref();

  // --- Routes ---
  app.get(
    APP_ROUTES.DASHBOARD,
    managementRateLimiter,
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

  // Status-override middleware is mounted only on the webhook ingest route.
  // Previously app.all would have set forcedStatus on unrelated routes whose paths
  // happen to share the same prefix, causing confusing side-effects.
  app.all(
    APP_ROUTES.WEBHOOK,
    /**
     * @param {CustomRequest} req
     * @param {Response} _res
     * @param {NextFunction} next
     */
    (req, _res, next) => {
      const statusOverride = Number.parseInt(
        String(req.query[QUERY_PARAMS.STATUS]),
        10,
      );
      if (
        Number.isInteger(statusOverride) &&
        validateStatusCode(statusOverride)
      ) {
        req.forcedStatus = statusOverride;
      }
      next();
    },
    loggerMiddlewareInstance.middleware,
  );

  app.all(
    APP_ROUTES.REPLAY,
    managementRateLimiter,
    authMiddleware,
    createReplayHandler(
      () => appState?.replayMaxRetries,
      () => appState?.replayTimeoutMs,
    ),
  );

  app.get(
    APP_ROUTES.LOG_STREAM,
    managementRateLimiter,
    authMiddleware,
    createLogStreamHandler(clients),
  );

  app.get(
    APP_ROUTES.LOGS,
    managementRateLimiter,
    authMiddleware,
    createLogsHandler(webhookManager),
  );

  app.get(
    APP_ROUTES.LOG_DETAIL,
    managementRateLimiter,
    authMiddleware,
    createLogDetailHandler(webhookManager),
  );

  app.get(
    APP_ROUTES.LOG_PAYLOAD,
    managementRateLimiter,
    authMiddleware,
    createLogPayloadHandler(webhookManager),
  );

  app.get(
    APP_ROUTES.INFO,
    managementRateLimiter,
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
    managementRateLimiter,
    authMiddleware,
    createSystemMetricsHandler(syncService),
  );

  // Health check endpoints (rate-limited but no auth required for orchestrators)
  const { health, ready } = createHealthRoutes(
    () => webhookManager.getAllActive().length,
  );
  app.get(APP_ROUTES.HEALTH, managementRateLimiter, health);
  app.get(APP_ROUTES.READY, managementRateLimiter, ready);

  // Error handling middleware (using modular factory)
  app.use(createErrorHandler());

  // -----------------------------------------------------------------------
  // 2. Constants & Configuration
  // -----------------------------------------------------------------------

  if (!IS_TEST()) {
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
  }

  return app;
}

if (!IS_TEST()) {
  initialize().catch((err) => {
    log.error({ err: serializeError(err) }, LOG_MESSAGES.SERVER_START_FAILED);
    systemExit(EXIT_CODES.FAILURE);
  });
}

export {
  app,
  webhookManager,
  server,
  sseHeartbeat,
  initialize,
  shutdown,
  resetShutdownForTest,
  setupGracefulShutdown,
  APP_VERSION,
};
