/**
 * @file tests/unit/utils/load_env.test.js
 * @description Unit tests for local .env loading behavior.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jest } from "@jest/globals";
import { ENV_VALUES, ENV_VARS } from "../../../src/consts/env.js";
import {
  loadProjectEnv,
  resetProjectEnvLoadState,
} from "../../../src/utils/load_env.js";
import { ENCODINGS } from "../../../src/consts/http.js";

const REPEATED_LOAD_ATTEMPTS = 100;
const ENV_PORT = 4545;
const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, "../../..");
const APP_CONSTS_MODULE_URL = pathToFileURL(
  path.join(REPO_ROOT, "src/consts/app.js"),
).href;

describe("loadProjectEnv", () => {
  const ORIGINAL_ENV = process.env;
  const ORIGINAL_CWD = process.cwd();

  /** @type {string[]} */
  let tempDirs = [];

  beforeEach(() => {
    resetProjectEnvLoadState();
    process.env = { ...ORIGINAL_ENV };
    tempDirs = [];
    jest.restoreAllMocks();
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    for (const dir of tempDirs) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  /**
   * @param {string} content
   * @returns {string}
   */
  function createTempEnvDir(content) {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "webhook-debugger-env-test-"),
    );
    fs.writeFileSync(path.join(dir, ".env"), content, ENCODINGS.UTF);
    tempDirs.push(dir);
    return dir;
  }

  it("should load .env values from the provided cwd when variables are unset", () => {
    const envValues = {
        [ENV_VARS.ACTOR_WEB_SERVER_PORT]: "9191",
        [ENV_VARS.LOG_LEVEL]: "debug",
        [ENV_VARS.INPUT]: '{"urlCount":7}',
    }
    const cwd = createTempEnvDir(
      [
        `${ENV_VARS.ACTOR_WEB_SERVER_PORT}=${envValues[ENV_VARS.ACTOR_WEB_SERVER_PORT]}`,
        `${ENV_VARS.LOG_LEVEL}=${envValues[ENV_VARS.LOG_LEVEL]}`,
        `${ENV_VARS.INPUT}=${envValues[ENV_VARS.INPUT]}`,
      ].join("\n"),
    );

    delete process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT];
    delete process.env[ENV_VARS.LOG_LEVEL];
    delete process.env[ENV_VARS.INPUT];

    const result = loadProjectEnv({ force: true, cwd });

    expect(result).toEqual({
      loaded: true,
      path: path.join(cwd, ".env"),
      skipped: false,
    });
    expect(process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT]).toBe(envValues[ENV_VARS.ACTOR_WEB_SERVER_PORT]);
    expect(process.env[ENV_VARS.LOG_LEVEL]).toBe(envValues[ENV_VARS.LOG_LEVEL]);
    expect(process.env[ENV_VARS.INPUT]).toBe(envValues[ENV_VARS.INPUT]);
  });

  it("should not override existing environment variables", () => {
    const cwd = createTempEnvDir(
      [`${ENV_VARS.ACTOR_WEB_SERVER_PORT}=9191`, `${ENV_VARS.LOG_LEVEL}=debug`].join("\n"),
    );

    process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT] = "8080";
    process.env[ENV_VARS.LOG_LEVEL] = "warn";

    loadProjectEnv({ force: true, cwd });

    expect(process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT]).toBe("8080");
    expect(process.env[ENV_VARS.LOG_LEVEL]).toBe("warn");
  });

  it("should skip automatic loading during Jest runs", () => {
    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    process.env[ENV_VARS.JEST_WORKER_ID] = "1";

    const result = loadProjectEnv();

    expect(result).toEqual({ loaded: false, path: null, skipped: true });
    expect(existsSyncSpy).not.toHaveBeenCalled();
  });

  it("should return not loaded when no .env file exists", () => {
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "webhook-debugger-env-missing-"),
    );
    tempDirs.push(cwd);

    const result = loadProjectEnv({ force: true, cwd });

    expect(result).toEqual({ loaded: false, path: null, skipped: false });
  });

  it("should remain idempotent across repeated load attempts", () => {
    const cwd = createTempEnvDir(`${ENV_VARS.LOG_LEVEL}=trace\n`);
    const readFileSpy = jest.spyOn(fs, "readFileSync");

    loadProjectEnv({ force: true, cwd });
    for (let index = 0; index < REPEATED_LOAD_ATTEMPTS; index += 1) {
      loadProjectEnv({ cwd });
    }

    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(process.env[ENV_VARS.LOG_LEVEL]).toBe("trace");
  });

  it("should expose values early enough for import-time constants", async () => {
    const cwd = createTempEnvDir(`${ENV_VARS.ACTOR_WEB_SERVER_PORT}=${ENV_PORT}\n`);
    /** @type {NodeJS.ProcessEnv} */
    const childEnv = { ...process.env };
    delete childEnv[ENV_VARS.JEST_WORKER_ID];
    delete childEnv[ENV_VARS.ACTOR_WEB_SERVER_PORT];
    childEnv[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;

    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          `process.chdir(${JSON.stringify(cwd)});`,
          `const mod = await import(${JSON.stringify(APP_CONSTS_MODULE_URL)});`,
          "console.log(mod.APP_CONSTS.DEFAULT_PORT);",
        ].join("\n"),
      ],
      {
        cwd: REPO_ROOT,
        env: childEnv,
        encoding: ENCODINGS.UTF,
      },
    );

    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe(String(ENV_PORT));
  });
});