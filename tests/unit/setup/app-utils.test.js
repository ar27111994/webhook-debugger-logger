/**
 * @file tests/unit/setup/app-utils.test.js
 * @description Guard-rail tests for the in-process integration harness helpers.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { assertType } from "../../setup/helpers/test-utils.js";

const APP_UTILS_MODULE_PATH = "../../setup/helpers/app-utils.js";

describe("setupTestApp", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("should throw a clear error when mkdtemp does not return a usable directory path", async () => {
    const rmMock = jest.fn();

    jest.unstable_mockModule("node:fs/promises", () => ({
      mkdtemp: jest.fn().mockResolvedValue(assertType("")),
      rm: rmMock,
    }));

    const { setupTestApp } = await import(APP_UTILS_MODULE_PATH);

    await expect(setupTestApp()).rejects.toThrow(
      "setupTestApp requires node:fs/promises mkdtemp() to return a non-empty string. Disable fs mocking for integration tests or provide a real mkdtemp implementation.",
    );
    expect(rmMock).not.toHaveBeenCalled();
  });
});
