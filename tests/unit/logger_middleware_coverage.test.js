import { describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  createMockWebhookManager,
  loggerMock,
} from "../setup/helpers/shared-mocks.js";

// Setup dependencies
await setupCommonMocks({
  apify: true,
  logger: true,
  consts: true,
});

// Import the class after mocking
const { LoggerMiddleware } = await import("../../src/logger_middleware.js");
import { HTTP_STATUS } from "../../src/consts/http.js";

/**
 * @typedef {import("../../src/webhook_manager.js").WebhookManager} WebhookManager
 */

describe("LoggerMiddleware Coverage", () => {
  describe("getValidStatusCode (Static)", () => {
    test("should return default code for invalid inputs", () => {
      expect(LoggerMiddleware.getValidStatusCode(undefined)).toBe(
        HTTP_STATUS.OK,
      );
      expect(LoggerMiddleware.getValidStatusCode(null)).toBe(HTTP_STATUS.OK);
      expect(LoggerMiddleware.getValidStatusCode("invalid")).toBe(
        HTTP_STATUS.OK,
      );
      expect(LoggerMiddleware.getValidStatusCode(NaN)).toBe(HTTP_STATUS.OK);
    });

    test("should return default code for out-of-bounds inputs", () => {
      expect(LoggerMiddleware.getValidStatusCode(99)).toBe(HTTP_STATUS.OK);
      expect(LoggerMiddleware.getValidStatusCode(600)).toBe(HTTP_STATUS.OK);
    });

    test("should return custom default code if provided", () => {
      expect(
        LoggerMiddleware.getValidStatusCode("bad", HTTP_STATUS.NOT_FOUND),
      ).toBe(HTTP_STATUS.NOT_FOUND);
    });

    test("should return valid status code", () => {
      expect(LoggerMiddleware.getValidStatusCode(HTTP_STATUS.CREATED)).toBe(
        HTTP_STATUS.CREATED,
      );
      expect(
        LoggerMiddleware.getValidStatusCode(HTTP_STATUS.NOT_FOUND.toString()),
      ).toBe(HTTP_STATUS.NOT_FOUND);
    });
  });

  describe("Configuration & Compilation", () => {
    /** @type {WebhookManager} */
    let webhookManagerMock;

    beforeEach(() => {
      webhookManagerMock = createMockWebhookManager();
      // Reset logger mock
      loggerMock.error.mockReset();
      loggerMock.info.mockReset();
    });

    test("should handle resource compilation errors gracefully (Script)", () => {
      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        {}, // No initial script
        () => {},
      );

      // Verify initial state
      expect(middleware.hasCompiledScript()).toBe(false);

      // Update with INVALID script
      middleware.updateOptions({
        customScript: "this is syntax error !!!",
      });

      // Should log error and NOT have compiled script
      expect(middleware.hasCompiledScript()).toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ errorPrefix: "SCRIPT-ERROR" }),
        "Invalid resource",
      );
    });

    test("should re-compile script only when changed", () => {
      const validScript = "console.log('test')";
      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        { customScript: validScript },
        () => {},
      );

      expect(middleware.hasCompiledScript()).toBe(true);
      loggerMock.info.mockClear();

      // Update with SAME script
      middleware.updateOptions({
        customScript: validScript,
      });

      // Should NOT re-compile (no success log)
      expect(loggerMock.info).not.toHaveBeenCalledWith(
        "Custom script re-compiled successfully.",
      );
    });

    test("should re-compile script when changed", () => {
      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        { customScript: "console.log(1)" },
        () => {},
      );

      loggerMock.info.mockClear();

      middleware.updateOptions({
        customScript: "console.log(2)",
      });

      expect(loggerMock.info).toHaveBeenCalledWith(
        "Custom script re-compiled successfully.",
      );
    });
  });
});
