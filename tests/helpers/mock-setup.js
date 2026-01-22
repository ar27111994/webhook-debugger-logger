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
 */

/**
 * Registers common mock modules for test isolation.
 *
 * This helper eliminates the need to manually set up jest.unstable_mockModule
 * for commonly used dependencies in every test file.
 *
 * @example
 * // At the top of your test file, BEFORE other imports:
 * import { setupCommonMocks } from "./helpers/mock-setup.js";
 * await setupCommonMocks({ axios: true, apify: true });
 *
 * // Now import your modules - they will use the mocks:
 * const { createLoggerMiddleware } = await import("../src/logger_middleware.js");
 *
 * @example
 * // For tests needing DNS and SSRF mocks:
 * await setupCommonMocks({ axios: true, apify: true, dns: true, ssrf: true });
 *
 * @param {MockOptions} [options={}] - Configuration for which mocks to register
 * @returns {Promise<void>}
 */
export async function setupCommonMocks(options = {}) {
  const { axios = true, apify = true, dns = false, ssrf = false } = options;

  if (axios) {
    jest.unstable_mockModule("axios", async () => {
      const { axiosMock } = await import("./shared-mocks.js");
      return { default: axiosMock };
    });
  }

  if (apify) {
    jest.unstable_mockModule("apify", async () => {
      const { apifyMock } = await import("./shared-mocks.js");
      return { Actor: apifyMock };
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
    jest.unstable_mockModule("../../src/utils/ssrf.js", async () => {
      const { ssrfMock } = await import("./shared-mocks.js");
      return ssrfMock;
    });
  }
}
