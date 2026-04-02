/**
 * @file tests/setup/helpers/integration-harness.js
 * @description Shared integration test harness utilities for bootstrapping the app in-process.
 * @module tests/setup/helpers/integration-harness
 */

import { setupTestApp } from "./app-utils.js";
import { HTTP_HEADERS } from "../../../src/consts/http.js";
import { AUTH_CONSTS } from "../../../src/consts/auth.js";

/**
 * @typedef {import("express").Express} ExpressApp
 * @typedef {import("supertest").Agent} AppClient
 */

/**
 * @typedef {Object} IntegrationAppContext
 * @property {ExpressApp} app
 * @property {AppClient} appClient
 * @property {() => Promise<void>} teardown
 */

/**
 * Boots the application in-process for integration tests.
 *
 * @param {Record<string, unknown>} [inputOverrides={}] Partial actor input overrides.
 * @param {boolean} [enableHotReload=false] Whether hot-reload polling should be enabled.
 * @returns {Promise<IntegrationAppContext>}
 */
export async function startIntegrationApp(
  inputOverrides = {},
  enableHotReload = false,
) {
  const { app, appClient, teardownApp } = await setupTestApp(
    inputOverrides,
    enableHotReload,
  );

  return {
    app,
    appClient,
    teardown: teardownApp,
  };
}

/**
 * Creates a bearer authorization header value.
 *
 * @param {string} token
 * @returns {{ authorization: string }}
 */
export function createBearerAuthHeader(token) {
  return {
    [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${token}`,
  };
}

/**
 * Creates readiness probe headers to bypass auth middleware on selected routes.
 *
 * @returns {{ [x: string]: string }}
 */
export function createReadinessProbeHeader() {
  return {
    [HTTP_HEADERS.APIFY_READINESS]: String(true),
  };
}
