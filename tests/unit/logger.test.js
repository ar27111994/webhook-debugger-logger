import { describe, test, expect, jest } from "@jest/globals";

/**
 * @typedef {import("../../src/utils/logger.js")} LoggerUtils
 * @typedef {import("pino").Logger} Logger
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 * @typedef {import("pino").Bindings} Bindings
 */

import { NODE_ERROR_CODES } from "../../src/consts/errors.js";

// Mock pino to avoid transport issues with pino-pretty
jest.unstable_mockModule("pino", () => {
  const createMockLogger = (bindings = {}) => ({
    level: "info",
    bindings: () => bindings,
    child: jest.fn(
      /**
       * @param {Bindings} newBindings
       */
      (newBindings) => createMockLogger({ ...bindings, ...newBindings }),
    ),
  });

  return {
    default: Object.assign(
      jest.fn(() => createMockLogger()),
      {
        transport: jest.fn(() => ({})),
        stdTimeFunctions: {
          isoTime: () => "2026-01-01T00:00:00.000Z",
        },
      },
    ),
  };
});

describe("Logger Utility", () => {
  /** @type {Logger} */
  let logger;
  /** @type {LoggerUtils["createChildLogger"]} */
  let createChildLogger;
  /** @type {LoggerUtils["createRequestLogger"]} */
  let createRequestLogger;
  /** @type {LoggerUtils["serializeError"]} */
  let serializeError;
  /** @type {LoggerUtils["LogLevel"]} */
  let LogLevel;

  async function loadLogger() {
    const mod = await import("../../src/utils/logger.js");
    logger = mod.logger;
    createChildLogger = mod.createChildLogger;
    createRequestLogger = mod.createRequestLogger;
    serializeError = mod.serializeError;
    LogLevel = mod.LogLevel;
  }

  describe("serializeError", () => {
    test("should serialize standard Error objects", async () => {
      await loadLogger();
      const err = new Error("test error");
      err.name = "TestError";
      err.stack = "stack trace";

      const result = serializeError(err);
      expect(result).toEqual({
        type: "TestError",
        message: "test error",
        stack: "stack trace",
      });
    });

    test("should include error code if present", async () => {
      await loadLogger();

      /** @type {CommonError} */
      const err = new Error("not found");
      err.code = NODE_ERROR_CODES.ENOENT;

      const result = serializeError(err);
      expect(result.code).toBe(NODE_ERROR_CODES.ENOENT);
    });

    test("should handle non-Error inputs", async () => {
      await loadLogger();
      expect(serializeError("string error")).toEqual({
        message: "string error",
      });
      expect(serializeError(404)).toEqual({
        message: "404",
      });
      expect(serializeError({ custom: "obj" })).toEqual({
        message: "[object Object]",
      });
    });
  });

  describe("Child Loggers", () => {
    test("createChildLogger should create a logger with bindings", async () => {
      await loadLogger();
      const child = createChildLogger({ module: "test" });
      expect(child).toBeDefined();
      expect(child.bindings()).toEqual({ module: "test" });
    });

    test("createRequestLogger should create a logger with requestId", async () => {
      await loadLogger();
      const reqLogger = createRequestLogger("req_123");
      expect(reqLogger.bindings()).toEqual({ requestId: "req_123" });
    });
  });

  describe("Logger Configuration & Branches", () => {
    test("logger should be initialized with correct level", async () => {
      await loadLogger();
      expect(logger.level).toBe(process.env.LOG_LEVEL || "info");
    });

    test("LogLevel enum should be correct", async () => {
      await loadLogger();
      expect(LogLevel.INFO).toBe("info");
      expect(LogLevel.ERROR).toBe("error");
    });

    test("should use pretty logs when PRETTY_LOGS is true", async () => {
      process.env.PRETTY_LOGS = "true";
      jest.resetModules();

      const mod = await import(`../../src/utils/logger.js?v=${Date.now()}`);
      expect(mod.logger).toBeDefined();

      delete process.env.PRETTY_LOGS;
    });

    test("should use standard logs when PRETTY_LOGS is false", async () => {
      process.env.PRETTY_LOGS = "false";
      jest.resetModules();

      const mod = await import(`../../src/utils/logger.js?v2=${Date.now()}`);
      expect(mod.logger).toBeDefined();
    });
  });
});
