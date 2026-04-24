/**
 * Application Test Utilities.
 *
 * These are used in tests to provide common functionality for setup, teardown
 * and testing the main application.
 *
 * @module tests/setup/helpers/app-utils
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Actor } from "apify";
import { jest } from "@jest/globals";
import request from "supertest";
import { ENV_VARS, SHUTDOWN_SIGNALS } from "../../../src/consts/app.js";
import { ENV_VALUES } from "../../../src/consts/env.js";
import { assertType } from "./test-utils.js";

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
  const previousDisableHotReload = process.env[ENV_VARS.DISABLE_HOT_RELOAD];
  const previousLocalStorageDir = process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR];
  const previousNodeEnv = process.env[ENV_VARS.NODE_ENV];
  const apifyLocalStorageDir = await mkdtemp(
    path.join(tmpdir(), "wdl-integration-"),
  );
  if (
    typeof apifyLocalStorageDir !== "string" ||
    apifyLocalStorageDir.length === 0
  ) {
    throw new TypeError(
      "setupTestApp requires node:fs/promises mkdtemp() to return a non-empty string. Disable fs mocking for integration tests or provide a real mkdtemp implementation.",
    );
  }
  const initialSigtermListeners = new Set(
    process.listeners(SHUTDOWN_SIGNALS.SIGTERM),
  );
  const initialSigintListeners = new Set(
    process.listeners(SHUTDOWN_SIGNALS.SIGINT),
  );
  /** @type {{ event: string, handler: (...args: any[]) => any }[]} */
  const actorListeners = [];
  const originalActorOn = Actor.on.bind(Actor);
  let didCleanup = false;

  const cleanup = async () => {
    if (didCleanup) {
      return;
    }

    didCleanup = true;
    Actor.on = originalActorOn;

    for (const listener of process.listeners(SHUTDOWN_SIGNALS.SIGTERM)) {
      if (!initialSigtermListeners.has(listener)) {
        process.off(SHUTDOWN_SIGNALS.SIGTERM, listener);
      }
    }
    for (const listener of process.listeners(SHUTDOWN_SIGNALS.SIGINT)) {
      if (!initialSigintListeners.has(listener)) {
        process.off(SHUTDOWN_SIGNALS.SIGINT, listener);
      }
    }
    for (const { event, handler } of actorListeners) {
      Actor.off(assertType(event), handler);
    }
    actorListeners.length = 0;

    if (previousDisableHotReload === undefined) {
      delete process.env[ENV_VARS.DISABLE_HOT_RELOAD];
    } else {
      process.env[ENV_VARS.DISABLE_HOT_RELOAD] = previousDisableHotReload;
    }

    if (previousLocalStorageDir === undefined) {
      delete process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR];
    } else {
      process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR] = previousLocalStorageDir;
    }

    if (previousNodeEnv === undefined) {
      delete process.env[ENV_VARS.NODE_ENV];
    } else {
      process.env[ENV_VARS.NODE_ENV] = previousNodeEnv;
    }

    await rm(apifyLocalStorageDir, { force: true, recursive: true });
  };

  if (enableHotReload) {
    process.env[ENV_VARS.DISABLE_HOT_RELOAD] = "false";
  } else {
    process.env[ENV_VARS.DISABLE_HOT_RELOAD] = "true";
  }
  process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;
  process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR] = apifyLocalStorageDir;

  const mainModuleUrl = new URL("../../../src/main.js", import.meta.url);
  mainModuleUrl.searchParams.set("testInstance", apifyLocalStorageDir);
  Actor.on = (event, handler) => {
    actorListeners.push({ event, handler });
    return originalActorOn(event, handler);
  };

  /** @type {typeof import("../../../src/main.js") | undefined} */
  let mainModule;
  try {
    jest.resetModules();
    mainModule = await import(mainModuleUrl.href);
    if (!mainModule) {
      throw new Error("Failed to load main module for test app setup");
    }
    await mainModule.initialize(options);
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    Actor.on = originalActorOn;
  }

  return {
    app: mainModule.app,
    appClient: request(mainModule.app),
    teardownApp: async () => {
      try {
        await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      } finally {
        try {
          mainModule.resetShutdownForTest();
        } finally {
          await cleanup();
        }
      }
    },
  };
};
