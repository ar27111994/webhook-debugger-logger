import request from "supertest";
import { ENV_VARS } from "../../../src/consts/app.js";

/**
 * @typedef {import("express").Express} App
 * @typedef {import("supertest").Agent} AppClient
 * @typedef {() => Promise<void>} TeardownApp
 */

/**
 * Initializes the application for testing.
 * Wraps common boilerplate: initialize(), supertest(app), and exposes a teardown function.
 *
 * @param {Object} [options]
 * @param {boolean} [enableHotReload]
 
 * @example
 * const { appClient, teardownApp } = await setupTestApp();
 * afterAll(teardownApp);
 *
 * @returns {Promise<{
 *   app: App,
 *   appClient: AppClient,
 *   teardownApp: TeardownApp
 * }>}
 */
export const setupTestApp = async (options = {}, enableHotReload = false) => {
  if (enableHotReload) {
    process.env[ENV_VARS.DISABLE_HOT_RELOAD] = "false";
  } else {
    process.env[ENV_VARS.DISABLE_HOT_RELOAD] = "true";
  }
  const { app, initialize } = await import("../../../src/main.js");
  await initialize(options);
  return {
    app,
    appClient: request(app),
    teardownApp: async () => {
      const { shutdown } = await import("../../../src/main.js");
      await shutdown("TEST_COMPLETE");
    },
  };
};
