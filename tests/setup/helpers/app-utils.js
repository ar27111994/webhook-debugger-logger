import request from "supertest";
import { app, initialize, shutdown } from "../../../src/main.js";

/**
 * @typedef {import("express").Express} App
 * @typedef {import("supertest").Agent} AppClient
 * @typedef {() => Promise<void>} TeardownApp
 */

/**
 * Initializes the application for testing.
 * Wraps common boilerplate: initialize(), supertest(app), and exposes a teardown function.
 *
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
export const setupTestApp = async () => {
  await initialize();
  return {
    app,
    appClient: request(app),
    teardownApp: async () => shutdown("TEST_COMPLETE"),
  };
};
