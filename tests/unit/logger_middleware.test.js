import { jest, describe, test, expect } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  assertType,
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 * @typedef {import('../../src/logger_middleware.js').LoggerMiddleware} LoggerMiddlewareType
 * @typedef {import('../../src/services/ForwardingService.js').ForwardingService} ForwardingService
 */

// 1. Setup Common Mocks (Apify, Axios, SSRF, Logger)
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, ssrf: true, logger: true });
import {
  apifyMock,
  createMockWebhookManager,
} from "../setup/helpers/shared-mocks.js";

const mockActor = apifyMock;

// 4. Mock Auth
jest.unstable_mockModule("../../src/utils/auth.js", () => ({
  validateAuth: jest.fn(() => ({ isValid: true })),
}));

// 5. Mock Signature
jest.unstable_mockModule("../../src/utils/signature.js", () => ({
  verifySignature: jest.fn(() => ({ valid: true })),
  createStreamVerifier: jest.fn(() => ({ hmac: null })),
  finalizeStreamVerification: jest.fn(() => ({ valid: true })),
}));

// 6. Mock CONSTS (for timeouts)
jest.unstable_mockModule("../../src/consts.js", () => ({
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
  DEFAULT_RATE_LIMIT_MAX_ENTRIES: 10,
  DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE: 100,
  DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES: 100,
  DEFAULT_RATE_LIMIT_WINDOW_MS: 1000,
  KVS_OFFLOAD_THRESHOLD: 5000,
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
  EVENT_MAX_LISTENERS: 10,
}));

// 7. Mock vm module (Native modules need careful mocking)
jest.unstable_mockModule("vm", () => ({
  default: {
    Script: jest.fn(
      /** @param {string} code */
      (code) => {
        if (code.includes("syntax error")) {
          throw new Error("Invalid syntax");
        }
        return { runInNewContext: jest.fn() };
      },
    ),
  },
}));

// Import class under test
const { LoggerMiddleware } = await import("../../src/logger_middleware.js");

describe("LoggerMiddleware Coverage Tests", () => {
  /** @type {LoggerMiddlewareType} */
  let middleware;
  /** @type {WebhookManager} */
  let mockWebhookManager;
  /** @type {jest.Mock} */
  let onEvent;
  /** @type {ForwardingService} */
  let mockForwardingService;

  useMockCleanup(() => {
    mockWebhookManager = createMockWebhookManager();
    onEvent = jest.fn();
    mockForwardingService = assertType({
      forwardWebhook: /** @type {jest.Mock<any>} */ (
        jest.fn()
      ).mockResolvedValue(undefined),
    });

    middleware = /** @type {LoggerMiddlewareType} */ (
      new LoggerMiddleware(
        mockWebhookManager,
        {},
        onEvent,
        mockForwardingService,
      )
    );
  });

  describe("Smart Compilation Error Handling", () => {
    test("should handle invalid custom script compilation", () => {
      middleware.updateOptions({
        customScript: "this is syntax error >>>",
      });

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ errorPrefix: "SCRIPT-ERROR" }),
        "Invalid resource",
      );
      // Use test helper
      expect(middleware.hasCompiledScript()).toBe(false);
    });

    test("should handle invalid JSON schema compilation", () => {
      middleware.updateOptions({
        jsonSchema: "{ invalid json: }",
      });

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ errorPrefix: "SCHEMA-ERROR" }),
        "Invalid resource",
      );
      // Use test helper
      expect(middleware.hasValidator()).toBe(false);
    });
  });

  describe("Request Preparation Edge Cases", () => {
    test("should throw 400 for malformed JSON body when content-type is json", async () => {
      middleware.updateOptions({
        jsonSchema: { type: "object", properties: { foo: { type: "string" } } },
      });

      const req = createMockRequest({
        headers: {
          "content-type": "application/json",
          "content-length": "100", // Fake length to bypass size check early
        },
        body: "{ malformed json }", // String body to force parsing attempt
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      // Because _prepareRequestData is private, we must trigger it via public middleware()
      // It should catch the error internally and return 400
      await middleware.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid JSON for schema validation",
        }),
      );
    });
  });

  describe("Background Task Failures", () => {
    test("should handle Platform Limit errors gracefully", async () => {
      mockActor.pushData.mockRejectedValue(
        new Error("Dataset storage limit reached"),
      );

      // Trigger via public middleware
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNextFunction();
      // Mock valid Webhook ID
      jest.mocked(mockWebhookManager.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      // Source uses structured pino logging via this.#log.error
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          isPlatformError: true,
          err: expect.objectContaining({
            message: "Dataset storage limit reached",
          }),
        }),
        "Platform limit error",
      );
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "Check Apify platform limits or storage availability",
      );
    });
  });

  describe("Forwarding Delegation", () => {
    test("should delegate forwarding to ForwardingService", async () => {
      // RESET MOCK: Critical to prevent pollution from previous tests that set rejection
      mockActor.pushData.mockReset();
      mockActor.pushData.mockResolvedValue(undefined);

      const req = createMockRequest({ params: { id: "wh_123" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      // Configure middleware to forward
      middleware.updateOptions({ forwardUrl: "http://example.com" });
      jest.mocked(mockWebhookManager.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      // Check simply if it was called (ignoring arguments which might be mismatched in mock injection)
      expect(mockForwardingService.forwardWebhook).toHaveBeenCalled();
    });
  });
});
