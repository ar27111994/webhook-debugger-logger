import request from "supertest";

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
export const setupTestApp = async (options = {}) => {
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
