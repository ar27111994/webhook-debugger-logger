import { jest, describe, test, expect } from "@jest/globals";
import { useMockCleanup } from "./helpers/test-lifecycle.js";
import { createMockRequest } from "./helpers/test-utils.js";

/**
 * @typedef {import('../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../src/typedefs.js').CommonError} CommonError
 * @typedef {import('../src/logger_middleware.js').LoggerMiddleware} LoggerMiddlewareType
 */

// 1. Setup Common Mocks (Apify, Axios, SSRF)
import { setupCommonMocks } from "./helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, ssrf: true });
import {
  apifyMock,
  axiosMock,
  createMockWebhookManager,
} from "./helpers/shared-mocks.js";

const mockActor = apifyMock;
const mockAxios = axiosMock;

// 4. Mock Auth
jest.unstable_mockModule("../src/utils/auth.js", () => ({
  validateAuth: jest.fn(() => ({ isValid: true })),
}));

// 5. Mock Signature
jest.unstable_mockModule("../src/utils/signature.js", () => ({
  verifySignature: jest.fn(() => ({ valid: true })),
}));

// 6. Mock CONSTS (for timeouts)
jest.unstable_mockModule("../src/consts.js", () => ({
  BACKGROUND_TASK_TIMEOUT_PROD_MS: 100,
  BACKGROUND_TASK_TIMEOUT_TEST_MS: 100,
  FORWARD_HEADERS_TO_IGNORE: [],
  FORWARD_TIMEOUT_MS: 100,
  DEFAULT_FORWARD_RETRIES: 3,
  MAX_SAFE_FORWARD_RETRIES: 10,
  SCRIPT_EXECUTION_TIMEOUT_MS: 100,
  SENSITIVE_HEADERS: ["authorization"],
  DEFAULT_PAYLOAD_LIMIT: 1024,
  DEFAULT_URL_COUNT: 1,
  DEFAULT_RETENTION_HOURS: 1,
  DEFAULT_RATE_LIMIT_PER_MINUTE: 10,
  MAX_ALLOWED_PAYLOAD_SIZE: 10000,
  DEFAULT_REPLAY_RETRIES: 3,
  DEFAULT_REPLAY_TIMEOUT_MS: 10000,
  MAX_SAFE_REPLAY_RETRIES: 10,
  MAX_SAFE_RATE_LIMIT_PER_MINUTE: 1000,
  MAX_SAFE_RETENTION_HOURS: 168,
  MAX_SAFE_URL_COUNT: 50,
  MAX_SAFE_REPLAY_TIMEOUT_MS: 60000,
  MAX_SAFE_RESPONSE_DELAY_MS: 10000,
  TRANSIENT_ERROR_CODES: [
    "ECONNABORTED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EAI_AGAIN",
    "ENOTFOUND",
  ],
}));

// Import class under test
const { LoggerMiddleware } = await import("../src/logger_middleware.js");

describe("LoggerMiddleware Coverage Tests", () => {
  /** @type {LoggerMiddlewareType} */
  let middleware;
  /** @type {WebhookManager} */
  let mockWebhookManager;
  /** @type {jest.Mock} */
  let onEvent;

  useMockCleanup(() => {
    mockWebhookManager = createMockWebhookManager();
    onEvent = jest.fn();

    middleware = /** @type {LoggerMiddlewareType} */ (
      new LoggerMiddleware(mockWebhookManager, {}, onEvent)
    );
  });

  describe("Smart Compilation Error Handling", () => {
    test("should handle invalid custom script compilation", () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      middleware.updateOptions({
        customScript: "this is syntax error >>>",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SCRIPT-ERROR] Invalid Custom Script:"),
        expect.any(String),
      );
      expect(middleware.compiledScript).toBeNull();
      consoleSpy.mockRestore();
    });

    test("should handle invalid JSON schema compilation", () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      middleware.updateOptions({
        jsonSchema: "{ invalid json: }",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SCHEMA-ERROR] Invalid JSON Schema:"),
        expect.any(String),
      );
      expect(middleware.validate).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("Request Preparation Edge Cases", () => {
    test("should throw 400 for malformed JSON body when content-type is json", () => {
      middleware.updateOptions({
        jsonSchema: { type: "object", properties: { foo: { type: "string" } } },
      });

      const req = createMockRequest({
        headers: { "content-type": "application/json" },
        body: "{ malformed json }",
      });

      try {
        middleware._prepareRequestData(req, middleware.options);
      } catch (err) {
        expect(err).toEqual({
          statusCode: 400,
          error: "Invalid JSON for schema validation",
        });
      }
    });
  });

  describe("Background Task Failures", () => {
    test("should handle Platform Limit errors gracefully", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      mockActor.pushData.mockRejectedValue(
        new Error("Dataset storage limit reached"),
      );

      /** @type {WebhookEvent} */
      const event = /** @type {WebhookEvent} */ ({
        webhookId: "test",
        id: "1",
      });
      const request = createMockRequest();

      await middleware._executeBackgroundTasks(event, request, {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[CRITICAL] PLATFORM-LIMIT"),
        expect.stringContaining("Dataset storage limit reached"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[ADVICE] Check your Apify platform limits"),
      );

      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe("Forwarding Retries & Failures", () => {
    test("should stop retrying on non-transient errors (404)", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      /** @type {CommonError} */
      const error = new Error("Not Found");

      error.code = "E_GENERIC";
      mockAxios.post.mockRejectedValue(error);

      /** @type {WebhookEvent} */
      const event = /** @type {WebhookEvent} */ ({ webhookId: "fw-test" });

      const request = createMockRequest();

      await middleware._forwardWebhook(event, request, {}, "http://target.com");

      // Should fail fast and capture error
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "forward_error",
          body: expect.stringContaining("Non-transient error"),
        }),
      );
      // Wait for 1 attempt
      expect(mockAxios.post).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });

    test("should exhaust retries on transient errors", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      /** @type {CommonError} */
      const error = new Error("Timeout");
      error.code = "ETIMEDOUT";
      mockAxios.post.mockRejectedValue(error);

      /** @type {WebhookEvent} */
      const event = /** @type {WebhookEvent} */ ({
        webhookId: "fw-retry-test",
      });

      const request = createMockRequest();

      await middleware._forwardWebhook(event, request, {}, "http://target.com");

      // Default (3)
      expect(mockAxios.post).toHaveBeenCalledTimes(3);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "forward_error",
          body: expect.stringContaining("after 3 attempts"),
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    test("should respect custom maxForwardRetries", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const error = new Error("Timeout");
      /** @type {CommonError} */
      (error).code = "ETIMEDOUT";
      mockAxios.post.mockRejectedValue(error);

      /** @type {WebhookEvent} */
      const event = /** @type {WebhookEvent} */ ({
        webhookId: "fw-custom-retry",
      });

      const request = createMockRequest();

      // Override global options for this call (simulate merged options)
      await middleware._forwardWebhook(
        event,
        request,
        { maxForwardRetries: 2 },
        "http://target.com",
      );

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "forward_error",
          body: expect.stringContaining("after 2 attempts"),
        }),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
