/**
 * @file tests/unit/utils/load_env_mocked.test.js
 * @description Mocked edge-path tests for project .env loading.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beforeEach,
  afterEach,
  afterAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  ENV_VALUES,
  ENV_VARS,
  ENV_WARNING_CODES,
} from "../../../src/consts/env.js";
import { ERROR_MESSAGES } from "../../../src/consts/errors.js";
import { ENCODINGS } from "../../../src/consts/http.js";

const LOAD_ENV_MODULE_PATH = "../../../src/utils/load_env.js";

describe("load_env mocked branches", () => {
  const ORIGINAL_ENV = process.env;

  /** @type {string[]} */
  let tempDirs = [];

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    tempDirs = [];
  });

  afterEach(() => {
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
      path.join(os.tmpdir(), "webhook-debugger-load-env-mocked-"),
    );
    fs.writeFileSync(path.join(dir, ".env"), content, ENCODINGS.UTF);
    tempDirs.push(dir);
    return dir;
  }

  it("should skip project env loading when NODE_ENV is test even without JEST_WORKER_ID", async () => {
    delete process.env[ENV_VARS.JEST_WORKER_ID];
    process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

    const { shouldSkipProjectEnvLoad } = await import(LOAD_ENV_MODULE_PATH);

    expect(shouldSkipProjectEnvLoad()).toBe(true);
  });

  it("should emit a warning when dotenv returns an error while reading an existing env file", async () => {
    const cwd = createTempEnvDir(`${ENV_VARS.LOG_LEVEL}=trace\n`);
    const dotenvError = new Error("dotenv failure");
    const emitWarningSpy = jest
      .spyOn(process, "emitWarning")
      .mockImplementation(() => {});

    jest.unstable_mockModule("dotenv", () => ({
      config: jest.fn(() => ({ error: dotenvError })),
    }));

    const { loadProjectEnv, resetProjectEnvLoadState, PROJECT_ENV_FILE_NAME } =
      await import(LOAD_ENV_MODULE_PATH);

    resetProjectEnvLoadState();

    const result = loadProjectEnv({ force: true, cwd });
    const expectedEnvPath = path.join(cwd, PROJECT_ENV_FILE_NAME);

    expect(result).toEqual({ loaded: false, path: null, skipped: false });
    expect(emitWarningSpy).toHaveBeenCalledWith(
      ERROR_MESSAGES.PROJECT_ENV_LOAD_FAILED(
        PROJECT_ENV_FILE_NAME,
        expectedEnvPath,
        dotenvError.message,
      ),
      { code: ENV_WARNING_CODES.PROJECT_ENV_LOAD_FAILED },
    );
  });
});
