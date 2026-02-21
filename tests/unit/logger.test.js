/**
 * @file tests/unit/logger.test.js
 * @description Unit tests for logger utility functions.
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { jest } from "@jest/globals";
import { assertType } from "../setup/helpers/test-utils.js";
import { ENV_VARS } from "../../src/consts/app.js";

/**
 * @typedef {import('../../src/utils/logger.js').serializeError} serializeError
 * @typedef {import('../../src/utils/logger.js').createChildLogger} createChildLogger
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 * @typedef {import('pino')} Logger
 */

describe("Logger Utils", () => {
  /** @type {serializeError} */
  let serializeError;
  /** @type {createChildLogger} */
  let createChildLogger;

  /** @type {Logger} */
  let pinoMock;
  /** @type {Logger['transport']} */
  let transportMock;

  const ORIGINAL_ENV = process.env;

  beforeAll(async () => {
    await setupCommonMocks({ pino: true });
    pinoMock = (await import("pino")).default;
    transportMock = pinoMock.transport;
  });

  beforeEach(async () => {
    jest.resetModules();
    await setupCommonMocks({ pino: true });
    process.env = { ...ORIGINAL_ENV };

    // Re-import to get fresh module state for method tests
    const loggerModule = await import("../../src/utils/logger.js");
    serializeError = loggerModule.serializeError;
    createChildLogger = loggerModule.createChildLogger;

    jest.mocked(pinoMock).mockClear();
    jest.mocked(transportMock).mockClear();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("serializeError", () => {
    it("should serialize standard Error objects", () => {
      const errorMessage = "Test error";
      const err = new Error(errorMessage);
      const serialized = serializeError(err);
      expect(serialized).toHaveProperty("message", errorMessage);
      expect(serialized).toHaveProperty("stack");
      expect(serialized).toHaveProperty("type", "Error");
    });

    it("should handle strings as error messages", () => {
      const errorMessage = "String error";
      const serialized = serializeError(errorMessage);
      expect(serialized).toHaveProperty("message", errorMessage);
    });

    it("should handle null/undefined gracefully (return empty object or similar)", () => {
      // Implementation returns { message: String(err) } for non-errors
      expect(serializeError(null)).toEqual({ message: "null" });
      expect(serializeError(undefined)).toEqual({ message: "undefined" });
    });

    it("should safely handle circular references in error objects", () => {
      const circularErr = new Error("Circular");
      // @ts-expect-error - Adding self reference for testing circular references
      circularErr.self = circularErr;
      const serialized = serializeError(circularErr);
      expect(serialized).toHaveProperty("message", "Circular");
    });
  });

  describe("createChildLogger", () => {
    it("should call pino.child with bindings", () => {
      const component = "TestInfo";

      createChildLogger({ component });
      expect(loggerMock.child).toHaveBeenCalledWith({ component });
    });
  });

  describe("createRequestLogger", () => {
    it("should create a child logger with requestId", async () => {
      const { createRequestLogger } = await import("../../src/utils/logger.js");
      const requestId = "req-123";
      createRequestLogger(requestId);
      expect(loggerMock.child).toHaveBeenCalledWith({ requestId });
    });
  });

  describe("serializeError with code", () => {
    it("should include error code if present", () => {
      /** @type {CommonError} */
      const err = new Error("System Error");
      err.code = "ECONNRESET";
      const serialized = serializeError(err);
      expect(serialized).toHaveProperty("code", "ECONNRESET");
    });
  });

  describe("Logger Initialization", () => {
    it("should use pino-pretty transport when PRETTY_LOGS is true", async () => {
      process.env[ENV_VARS.PRETTY_LOGS] = "true";
      const transport = { isTransport: true };
      jest.mocked(transportMock).mockReturnValue(assertType(transport));

      // Force module reload by appending query string
      await import(`../../src/utils/logger.js?t=${Date.now()}`);

      expect(transportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "pino-pretty",
        }),
      );
      // Verify pino was called with the transport result
      expect(pinoMock).toHaveBeenCalledWith(expect.anything(), transport);
      expect(jest.mocked(pinoMock).mock.calls[0].length).toBe(1 + 1);
    });

    it("should NOT use transport when PRETTY_LOGS is false", async () => {
      process.env[ENV_VARS.PRETTY_LOGS] = "false";
      await import(`../../src/utils/logger.js?t=${Date.now()}`);

      expect(transportMock).not.toHaveBeenCalled();
      // pino(config) - 1 arg
      expect(jest.mocked(pinoMock).mock.calls[0].length).toBe(1);
    });
  });
});
