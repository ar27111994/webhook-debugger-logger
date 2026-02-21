/**
 * @file tests/unit/system.test.js
 * @description Unit tests for system wrapper utility functions.
 */

import { jest } from "@jest/globals";
import { exit, on } from "../../src/utils/system.js";
import { assertType } from "../setup/helpers/test-utils.js";
import { EXIT_CODES, SHUTDOWN_SIGNALS } from "../../src/consts/app.js";

describe("System Utils", () => {
  /** @type {typeof process.exit} */
  let originalExit;
  /** @type {typeof process.on} */
  let originalOn;

  beforeAll(() => {
    originalExit = process.exit;
    originalOn = process.on;
  });

  afterAll(() => {
    process.exit = originalExit;
    process.on = originalOn;
  });

  describe("exit", () => {
    it("should call process.exit with the correct code", () => {
      const exitSpy = jest.fn();
      process.exit = assertType(exitSpy);

      exit(EXIT_CODES.FAILURE);
      expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.FAILURE);

      exit(EXIT_CODES.SUCCESS);
      expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.SUCCESS);
    });
  });

  describe("on", () => {
    it("should call process.on with event and handler", () => {
      const onSpy = jest.fn();
      process.on = assertType(onSpy);

      const handler = () => {};
      on(SHUTDOWN_SIGNALS.SIGTERM, handler);

      expect(onSpy).toHaveBeenCalledWith(SHUTDOWN_SIGNALS.SIGTERM, handler);
    });
  });
});
