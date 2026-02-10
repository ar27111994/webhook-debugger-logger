import { jest, describe, test, expect } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  assertType,
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
  sleep,
} from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 * @typedef {import('../../src/logger_middleware.js').LoggerMiddleware} LoggerMiddlewareType
 * @typedef {import('../../src/services/ForwardingService.js').ForwardingService} ForwardingService
 */

// 1. Setup Common Mocks
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({
  axios: true,
  apify: true,
  ssrf: true,
  logger: true,
  auth: true,
  signature: true,
  rateLimit: true,
  storage: true,
  config: true,
  alerting: true,
  events: true,
  vm: true,
});

import {
  apifyMock,
  ssrfMock,
  webhookManagerMock,
  mockScriptRun,
  loggerMock,
} from "../setup/helpers/shared-mocks.js";
import { HTTP_STATUS } from "../../src/consts.js";

const mockActor = apifyMock;

// Import class under test
const { LoggerMiddleware } = await import("../../src/logger_middleware.js");
const { webhookRateLimiter } =
  await import("../../src/utils/webhook_rate_limiter.js");

describe("LoggerMiddleware Coverage Tests", () => {
  /** @type {LoggerMiddlewareType} */
  let middleware;
  /** @type {jest.Mock} */
  let onEvent;
  /** @type {ForwardingService} */
  let mockForwardingService;

  useMockCleanup(() => {
    onEvent = jest.fn();
    mockForwardingService = assertType({
      forwardWebhook: assertType(jest.fn()).mockResolvedValue(undefined),
    });

    middleware = new LoggerMiddleware(
      webhookManagerMock,
      {},
      onEvent,
      mockForwardingService,
    );
  });

  describe("Ingest Middleware", () => {
    test("should skip non-POST/PUT/DELETE methods", async () => {
      const req = createMockRequest({ method: "GET" });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should handle rate limit exceeded", async () => {
      jest.mocked(webhookRateLimiter.check).mockReturnValueOnce({
        allowed: false,
        remaining: 0,
        resetMs: 1000,
      });
      const req = createMockRequest({ method: "POST", params: { id: "wh_1" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await middleware.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.TOO_MANY_REQUESTS);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Too Many Requests" }),
      );
    });

    test("should reject payload too large via Content-Length", async () => {
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: { "content-length": "2000" }, // > default 1024 mock
      });
      // Set maxPayloadSize in options (mock resolveOptions logic or pass in constructor opts)
      middleware.updateOptions({ maxPayloadSize: 1000 });

      const res = createMockResponse();
      const next = createMockNextFunction();

      await middleware.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.PAYLOAD_TOO_LARGE);
    });
  });

  describe("Validation Logic (via main middleware)", () => {
    test("should return 404 if webhook ID is invalid", async () => {
      jest.mocked(webhookManagerMock.isValid).mockReturnValue(false);
      const req = createMockRequest({ params: { id: "invalid" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await middleware.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
    });

    test("should return 403 if IP is not whitelisted", async () => {
      middleware.updateOptions({ allowedIps: ["1.2.3.4"] });
      ssrfMock.checkIpInRanges.mockReturnValue(false);

      const req = createMockRequest({ ip: "5.6.7.8", params: { id: "wh_1" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
    });

    test("should return 401 if auth fails", async () => {
      middleware.updateOptions({ authKey: "invalid-key" }); // triggers mock logic

      const req = createMockRequest({ params: { id: "wh_1" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
    });
  });

  describe("Preparation & Transformation", () => {
    test("should mask sensitive headers", async () => {
      middleware.updateOptions({ maskSensitiveData: true });

      const req = createMockRequest({
        params: { id: "wh_1" },
        headers: {
          authorization: "secret",
          "content-type": "application/json",
        },
        body: {},
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);
      expect(mockActor.pushData.mock.calls[0][0].headers["authorization"]).toBe(
        "[MASKED]",
      );
    });

    test("should deeply redact body paths", async () => {
      middleware.updateOptions({
        redactBodyPaths: ["body.user.password", "body.creditCard.number"],
      });

      const req = createMockRequest({
        params: { id: "wh_1" },
        body: {
          user: { name: "John", password: "secret_password" },
          creditCard: { number: "1234-5678", expiry: "12/24" },
          other: "safe",
        },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      // Verify Actor.pushData call
      const pushCall = mockActor.pushData.mock.calls[0][0];
      const body = JSON.parse(pushCall.body);

      expect(body.user.password).toBe("[REDACTED]");
      expect(body.user.name).toBe("John");
      expect(body.creditCard.number).toBe("[REDACTED]");
      expect(body.creditCard.expiry).toBe("12/24");
      expect(body.other).toBe("safe");
    });

    test("should validate JSON schema if configured", async () => {
      middleware.updateOptions({
        jsonSchema: { type: "object", required: ["foo"] },
      });

      const req = createMockRequest({
        params: { id: "wh_1" },
        headers: { "content-type": "application/json" },
        body: { bar: 1 }, // missing foo
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "JSON Schema Validation Failed" }),
      );
    });
  });

  describe("Custom Scripts", () => {
    test("should run custom script and log error on timeout", async () => {
      middleware.updateOptions({ customScript: "example" });
      mockScriptRun.mockImplementation(() => {
        /** @type {CommonError} */
        const e = new Error("Script execution timed out");
        e.code = "ERR_SCRIPT_EXECUTION_TIMEOUT";
        throw e;
      });

      const req = createMockRequest({ params: { id: "wh_1" }, body: {} });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      expect(mockScriptRun).toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ isTimeout: true }),
        expect.stringContaining("timed out"),
      );
    });
  });

  describe("Background Tasks", () => {
    test("should log warn on platform execution error", async () => {
      mockActor.pushData.mockRejectedValue(new Error("Dataset quota exceeded"));

      const req = createMockRequest({ params: { id: "wh_1" }, body: {} });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      // Wait for background tasks (they are race-protected but we want to assert log)
      await sleep(10);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ isPlatformError: true }),
        "Platform limit error",
      );
    });
  });

  describe("Signature Verification", () => {
    test("should pass valid signature", async () => {
      middleware.updateOptions({
        signatureVerification: { provider: "github", secret: "foo" },
      });
      // Mock verifySignature to return valid (already default in mock-setup but explicit here)
      const { verifySignature } = await import("../../src/utils/signature.js");
      jest.mocked(verifySignature).mockReturnValue({
        valid: true,
        provider: "github",
      });

      const req = createMockRequest({
        params: { id: "wh_1" },
        headers: { "x-hub-signature": "sha256=valid" },
        body: "{}",
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      // Verify event has signature info
      const pushCall = mockActor.pushData.mock.calls[0][0];
      expect(pushCall.signatureValid).toBe(true);
    });

    test("should record error on invalid signature", async () => {
      middleware.updateOptions({
        signatureVerification: { provider: "github", secret: "foo" },
      });
      const { verifySignature } = await import("../../src/utils/signature.js");
      jest.mocked(verifySignature).mockReturnValue({
        valid: false,
        error: "Mismatch",
        provider: "github",
      });

      const req = createMockRequest({
        params: { id: "wh_1" },
        body: "{}",
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid signature" }),
      );
      expect(mockActor.pushData).toHaveBeenCalled();
    });
  });

  describe("Payload Offloading", () => {
    test("should offload to KVS if body (sync) exceeds threshold", async () => {
      // Threshold is 5MB in code, let's force a large body simulation
      const largeBody = "a".repeat(5 * 1024 * 1024 + 100); // 5MB + 100
      const req = createMockRequest({
        params: { id: "wh_1" },
        body: largeBody,
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      await middleware.middleware(req, res, next);

      const pushCall = mockActor.pushData.mock.calls[0][0];
      const body = JSON.parse(pushCall.body);
      expect(body.isReference).toBe(true);
    });
  });
});
