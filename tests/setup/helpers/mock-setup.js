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
import { apifyMock } from "./shared-mocks.js";

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
 * @property {boolean} [fs=false] - Register fs/promises and fs mock
 */

/**
 * Shared logger mock for test assertions.
 * Import this in tests to verify logging behavior.
 *
 * @example
 * import { loggerMock } from "../setup/helpers/mock-setup.js";
 * expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ component: "Main" }), "Failed");
 */
export const loggerMock = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(function () {
    return loggerMock;
  }),
};

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
    fs = false,
  } = options;

  if (fs) {
    jest.unstable_mockModule("fs/promises", async () => {
      const { fsPromisesMock } = await import("./shared-mocks.js");
      return {
        __esModule: true,
        ...fsPromisesMock,
        default: fsPromisesMock,
      };
    });

    jest.unstable_mockModule("fs", async () => {
      const { fsMock } = await import("./shared-mocks.js");
      return {
        __esModule: true,
        ...fsMock,
        default: fsMock,
      };
    });
  }

  if (axios) {
    jest.unstable_mockModule("axios", async () => {
      const { axiosMock } = await import("./shared-mocks.js");
      return { default: axiosMock };
    });
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
    jest.unstable_mockModule("dns/promises", async () => {
      const { dnsPromisesMock } = await import("./shared-mocks.js");
      return {
        __esModule: true,
        ...dnsPromisesMock,
        default: dnsPromisesMock,
      };
    });
  }

  if (ssrf) {
    jest.unstable_mockModule("../../../src/utils/ssrf.js", async () => {
      const { ssrfMock } = await import("./shared-mocks.js");
      return ssrfMock;
    });
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
    jest.unstable_mockModule("express", async () => {
      const { expressMock } = await import("./shared-mocks.js");
      return { default: expressMock };
    });
  }

  if (db) {
    jest.unstable_mockModule("../../../src/db/duckdb.js", async () => {
      const { duckDbMock } = await import("./shared-mocks.js");
      return duckDbMock;
    });
  }

  if (sync) {
    jest.unstable_mockModule(
      "../../../src/services/SyncService.js",
      async () => {
        const { syncServiceMock } = await import("./shared-mocks.js");
        return { SyncService: jest.fn(() => syncServiceMock) };
      },
    );
  }

  if (loggerMiddleware) {
    jest.unstable_mockModule("../../../src/logger_middleware.js", async () => {
      const { loggerMiddlewareMock } = await import("./shared-mocks.js");
      return { LoggerMiddleware: jest.fn(() => loggerMiddlewareMock) };
    });
  }

  if (appState) {
    jest.unstable_mockModule("../../../src/utils/app_state.js", async () => {
      const { appStateMock } = await import("./shared-mocks.js");
      return { AppState: jest.fn(() => appStateMock) };
    });
  }

  if (hotReload) {
    jest.unstable_mockModule(
      "../../../src/utils/hot_reload_manager.js",
      async () => {
        const { hotReloadManagerMock } = await import("./shared-mocks.js");
        return {
          HotReloadManager: jest.fn(() => hotReloadManagerMock),
        };
      },
    );
  }

  if (bootstrap) {
    jest.unstable_mockModule("../../../src/utils/bootstrap.js", async () => {
      const { bootstrapMock } = await import("./shared-mocks.js");
      return bootstrapMock;
    });
  }

  if (routes) {
    jest.unstable_mockModule("../../../src/routes/index.js", async () => {
      const { routesMock } = await import("./shared-mocks.js");
      return routesMock;
    });
  }

  if (middleware) {
    jest.unstable_mockModule("../../../src/middleware/index.js", async () => {
      const { middlewareFactoriesMock } = await import("./shared-mocks.js");
      return middlewareFactoriesMock;
    });
  }

  if (consts) {
    jest.unstable_mockModule("../../../src/consts.js", async () => {
      const { constsMock } = await import("./shared-mocks.js");
      return constsMock;
    });
  }

  if (webhookManager) {
    jest.unstable_mockModule("../../../src/webhook_manager.js", async () => {
      const { webhookManagerMock } = await import("./shared-mocks.js");
      return { WebhookManager: jest.fn(() => webhookManagerMock) };
    });
  }

  if (auth) {
    jest.unstable_mockModule("../../../src/utils/auth.js", async () => {
      const { authMock } = await import("./shared-mocks.js");
      return authMock;
    });
  }

  if (signature) {
    jest.unstable_mockModule("../../../src/utils/signature.js", async () => {
      const { signatureMock } = await import("./shared-mocks.js");
      return signatureMock;
    });
  }

  if (rateLimit) {
    jest.unstable_mockModule(
      "../../../src/utils/webhook_rate_limiter.js",
      async () => {
        const { webhookRateLimiterMock } = await import("./shared-mocks.js");
        return webhookRateLimiterMock;
      },
    );
  }

  if (storage) {
    jest.unstable_mockModule(
      "../../../src/utils/storage_helper.js",
      async () => {
        const { storageHelperMock } = await import("./shared-mocks.js");
        return storageHelperMock;
      },
    );
  }

  if (config) {
    jest.unstable_mockModule("../../../src/utils/config.js", async () => {
      const { configMock } = await import("./shared-mocks.js");
      return configMock;
    });
  }

  if (alerting) {
    jest.unstable_mockModule("../../../src/utils/alerting.js", async () => {
      const { alertingMock } = await import("./shared-mocks.js");
      return alertingMock;
    });
  }

  if (events) {
    jest.unstable_mockModule("../../../src/utils/events.js", async () => {
      const { eventsMock } = await import("./shared-mocks.js");
      return eventsMock;
    });
  }

  if (vm) {
    jest.unstable_mockModule("vm", async () => {
      const { vmMock } = await import("./shared-mocks.js");
      return vmMock;
    });
  }

  if (repositories) {
    jest.unstable_mockModule(
      "../../../src/repositories/LogRepository.js",
      async () => {
        const { logRepositoryMock } = await import("./shared-mocks.js");
        return { logRepository: logRepositoryMock };
      },
    );
  }
}
