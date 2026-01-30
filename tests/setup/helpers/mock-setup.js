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

/**
 * @typedef {Object} MockOptions
 * @property {boolean} [axios=true] - Register axios mock
 * @property {boolean} [apify=true] - Register Apify Actor mock
 * @property {boolean} [dns=false] - Register dns/promises mock
 * @property {boolean} [ssrf=false] - Register SSRF utils mock
 * @property {boolean} [logger=false] - Register structured logger mock
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
  } = options;

  if (axios) {
    jest.unstable_mockModule("axios", async () => {
      const { axiosMock } = await import("./shared-mocks.js");
      return { default: axiosMock };
    });
  }

  if (apify) {
    jest.unstable_mockModule("apify", async () => {
      const { createApifyMock } = await import("./apify-mock.js");
      const apifyMock = createApifyMock();
      return {
        // Mock default export
        default: apifyMock,
        // Mock named exports
        Actor: apifyMock,
        KeyValueStore: apifyMock.openKeyValueStore(),
        Dataset: apifyMock.openDataset(),
      };
    });
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
      serializeError: jest.fn((err) => ({
        message: err instanceof Error ? err.message : String(err),
      })),
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
}
