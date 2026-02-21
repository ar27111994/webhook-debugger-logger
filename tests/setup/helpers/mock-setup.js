/**
 * Centralized mock module registration for test isolation.
 *
 * IMPORTANT: This module MUST be imported BEFORE any source code imports
 * in your test files, as Jest's module mocking must happen before the
 * modules are loaded.
 *
 * @module tests/helpers/mock-setup
 */

import { jest } from "@jest/globals";
import nodeFs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  apifyMock,
  constsMock,
  duckDbMock,
  logRepositoryMock,
  axiosMock,
  dnsPromisesMock,
  loggerMock,
  expressMock,
  appStateMock,
  loggerMiddlewareMock,
  webhookManagerMock,
  configMock,
  routesMock,
  middlewareFactoriesMock as middlewareMock,
  bootstrapMock,
  hotReloadManagerMock as hotReloadMock,
  webhookRateLimiterMock as rateLimitMock,
  authMock,
  signatureMock,
  storageHelperMock,
  alertingMock,
  vmMock,
  syncServiceMock,
  fsPromisesMock,
  fsMock,
  ssrfMock,
  eventsMock,
  createMockWithGetters,
  servicesFileMock,
  pinoMock,
  cryptoMock,
  cryptoUtilsMock,
  systemMock,
  commonUtilsMock,
  routeUtilsMock,
} from "./shared-mocks.js";

/**
 * @typedef {import("../../../src/typedefs.js").CommonError} CommonError
 */

/**
 * @typedef {Object} MockOptions
 * @property {boolean} [axios=true] - Register axios mock
 * @property {boolean} [apify=true] - Register Apify Actor mock
 * @property {boolean} [dns=false] - Register dns/promises mock
 * @property {boolean} [ssrf=false] - Register SSRF utils mock
 * @property {boolean} [logger=false] - Register structured logger mock
 * @property {boolean} [express=false] - Register Express mock
 * @property {boolean} [db=false] - Register DuckDB mock
 * @property {boolean} [sync=false] - Register SyncService mock
 * @property {boolean} [loggerMiddleware=false] - Register LoggerMiddleware mock
 * @property {boolean} [appState=false] - Register AppState mock
 * @property {boolean} [hotReload=false] - Register HotReloadManager mock
 * @property {boolean} [bootstrap=false] - Register Bootstrap utils mock
 * @property {boolean} [routes=false] - Register Routes factories mock
 * @property {boolean} [middleware=false] - Register Middleware factories mock
 * @property {boolean} [consts=false] - Register Consts mock
 * @property {boolean} [webhookManager=false] - Register WebhookManager mock
 * @property {boolean} [auth=false] - Register Auth util mock
 * @property {boolean} [signature=false] - Register Signature util mock
 * @property {boolean} [rateLimit=false] - Register WebhookRateLimiter util mock
 * @property {boolean} [storage=false] - Register Storage Helper util mock
 * @property {boolean} [config=false] - Register Config util mock
 * @property {boolean} [alerting=false] - Register Alerting util mock
 * @property {boolean} [events=false] - Register Events util mock
 * @property {boolean} [vm=false] - Register VM module mock
 * @property {boolean} [repositories=false] - Register LogRepository mock
 * @property {boolean} [services=false] - Register ForwardingService mock
 * @property {boolean} [fs=false] - Register fs/promises and fs mock
 * @property {boolean} [system=false] - Register system util mock
 * @property {boolean} [pino=false] - Register pino mock
 * @property {boolean} [crypto=false] - Register native crypto mock
 * @property {boolean} [utilCrypto=false] - Register src/utils/crypto.js mock
 * @property {boolean} [commonUtils=false] - Register src/utils/common.js mock
 * @property {boolean} [routeUtils=false] - Register src/routes/utils.js mock
 */

/**
 * Registers common mock modules for test isolation.
 *
 * This helper eliminates the need to manually set up jest.unstable_mockModule
 * for commonly used dependencies in every test file.
 *
 * @example
 * // At the top of your test file, BEFORE other imports:
 * import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
 * await setupCommonMocks({ axios: true, apify: true });
 *
 * // Now import your modules - they will use the mocks:
 * const { createLoggerMiddleware } = await import("../../src/logger_middleware.js");
 *
 * @example
 * // For tests needing DNS and SSRF mocks:
 * await setupCommonMocks({ axios: true, apify: true, dns: true, ssrf: true });
 *
 * @param {MockOptions} [options={}] - Configuration for which mocks to register
 * @returns {Promise<void>}
 */
export async function setupCommonMocks(options = {}) {
  const {
    axios = true,
    apify = true,
    dns = false,
    ssrf = false,
    logger = false,
    express = false,
    db = false,
    sync = false,
    // New Mocks
    loggerMiddleware = false,
    appState = false,
    hotReload = false,
    bootstrap = false,
    routes = false,
    middleware = false,
    consts = false,
    webhookManager = false,
    auth = false,
    signature = false,
    rateLimit = false,
    storage = false,
    config = false,
    alerting = false,
    events = false,
    vm = false,
    repositories = false,
    services = false,
    fs = false,
    system = false,
    pino = false,
    crypto = false,
    utilCrypto = false,
    commonUtils = false,
    routeUtils = false,
  } = options;

  if (fs) {
    const fsPromisesRegistry = {
      ...fsPromisesMock,
      default: fsPromisesMock,
      __esModule: true,
    };
    jest.unstable_mockModule("fs/promises", () => fsPromisesRegistry);
    jest.unstable_mockModule("node:fs/promises", () => fsPromisesRegistry);

    const fsRegistry = {
      ...fsMock,
      default: fsMock,
      __esModule: true,
    };
    jest.unstable_mockModule("fs", () => fsRegistry);
    jest.unstable_mockModule("node:fs", () => fsRegistry);
  }

  if (axios) {
    jest.unstable_mockModule("axios", () => ({
      default: axiosMock,
    }));
  }

  if (apify) {
    jest.unstable_mockModule("apify", () => ({
      // Mock default export
      default: apifyMock, // Use the instance directly
      // Mock named exports
      Actor: apifyMock,
      KeyValueStore: apifyMock.openKeyValueStore(),
      Dataset: apifyMock.openDataset(),
    }));
  }

  if (dns) {
    jest.unstable_mockModule("dns/promises", () => ({
      __esModule: true,
      ...dnsPromisesMock,
      default: dnsPromisesMock,
    }));
  }

  if (ssrf) {
    jest.unstable_mockModule("../../../src/utils/ssrf.js", () => ssrfMock);
  }

  if (logger) {
    jest.unstable_mockModule("../../../src/utils/logger.js", () => ({
      logger: loggerMock,
      createChildLogger: jest.fn(() => loggerMock),
      createRequestLogger: jest.fn(() => loggerMock),
      serializeError: jest.fn(
        /**
         * @param {any} err
         * @returns {CommonError}
         */
        (err) => ({
          message:
            err instanceof Error ? err.message : String(err?.message || err),
          stack: err instanceof Error ? err.stack : undefined,
          name: err instanceof Error ? err.name : undefined,
        }),
      ),
      LogLevel: {
        TRACE: "trace",
        DEBUG: "debug",
        INFO: "info",
        WARN: "warn",
        ERROR: "error",
        FATAL: "fatal",
      },
    }));
  }

  if (express) {
    jest.unstable_mockModule("express", () => ({
      default: expressMock,
    }));
  }

  if (db) {
    jest.unstable_mockModule("../../../src/db/duckdb.js", () => duckDbMock);
  }

  if (sync) {
    jest.unstable_mockModule("../../../src/services/SyncService.js", () => ({
      SyncService: jest.fn(() => syncServiceMock),
    }));
  }

  if (loggerMiddleware) {
    jest.unstable_mockModule("../../../src/logger_middleware.js", () => ({
      LoggerMiddleware: jest.fn(() => loggerMiddlewareMock),
    }));
  }

  if (appState) {
    jest.unstable_mockModule("../../../src/utils/app_state.js", () => ({
      AppState: jest.fn(() => appStateMock),
    }));
  }

  if (hotReload) {
    jest.unstable_mockModule(
      "../../../src/utils/hot_reload_manager.js",
      () => ({ HotReloadManager: jest.fn(() => hotReloadMock) }),
    );
  }

  if (bootstrap) {
    jest.unstable_mockModule(
      "../../../src/utils/bootstrap.js",
      () => bootstrapMock,
    );
  }

  if (routes) {
    jest.unstable_mockModule("../../../src/routes/index.js", () => routesMock);
  }

  if (middleware) {
    jest.unstable_mockModule(
      "../../../src/middleware/index.js",
      () => middlewareMock,
    );
  }

  if (consts) {
    // Dynamically discover and mock all constant modules
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const constsDir = path.resolve(__dirname, "../../../src/consts");

    const constModules = nodeFs
      .readdirSync(constsDir)
      .filter((file) => file.endsWith(".js"));

    // Mock both the direct modules and the index aggregator
    const index = "index.js";
    const modulesToMock = [index, ...constModules.filter((m) => m !== index)];

    for (const moduleName of modulesToMock) {
      jest.unstable_mockModule(`../../../src/consts/${moduleName}`, () => {
        return createMockWithGetters({}, constsMock);
      });
    }
  }

  if (webhookManager) {
    jest.unstable_mockModule("../../../src/webhook_manager.js", () => ({
      WebhookManager: jest.fn(() => webhookManagerMock),
    }));
  }

  if (auth) {
    jest.unstable_mockModule("../../../src/utils/auth.js", () => authMock);
  }

  if (signature) {
    jest.unstable_mockModule("../../../src/utils/signature.js", () => ({
      ...signatureMock,
      __esModule: true,
    }));
  }

  if (rateLimit) {
    jest.unstable_mockModule(
      "../../../src/utils/webhook_rate_limiter.js",
      () => rateLimitMock,
    );
  }

  if (storage) {
    jest.unstable_mockModule(
      "../../../src/utils/storage_helper.js",
      () => storageHelperMock,
    );
  }

  if (config) {
    jest.unstable_mockModule("../../../src/utils/config.js", () => configMock);
  }

  if (alerting) {
    jest.unstable_mockModule(
      "../../../src/utils/alerting.js",
      () => alertingMock,
    );
  }

  if (events) {
    jest.unstable_mockModule("../../../src/utils/events.js", () => eventsMock);
  }

  if (vm) {
    jest.unstable_mockModule("vm", () => vmMock);
  }

  if (repositories) {
    jest.unstable_mockModule(
      "../../../src/repositories/LogRepository.js",
      () => ({ logRepository: logRepositoryMock }),
    );
  }

  if (services) {
    jest.unstable_mockModule("../../../src/services/index.js", () => ({
      ...servicesFileMock,
    }));
  }

  if (system) {
    jest.unstable_mockModule("../../../src/utils/system.js", () => systemMock);
  }

  if (pino) {
    jest.unstable_mockModule("pino", () => ({
      default: pinoMock,
    }));
  }

  if (crypto) {
    jest.unstable_mockModule("crypto", () => ({
      default: cryptoMock,
      ...cryptoMock,
    }));
  }

  if (utilCrypto) {
    jest.unstable_mockModule(
      "../../../src/utils/crypto.js",
      () => cryptoUtilsMock,
    );
  }

  if (commonUtils) {
    jest.unstable_mockModule(
      "../../../src/utils/common.js",
      () => commonUtilsMock,
    );
  }

  if (routeUtils) {
    jest.unstable_mockModule(
      "../../../src/routes/utils.js",
      () => routeUtilsMock,
    );
  }
}
