/**
 * @file tests/unit/logger_middleware_final.test.js
 * @description Comprehensive unit tests for LoggerMiddleware covering all logic paths.
 */
import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
} from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  assertType,
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
  sleep,
} from "../setup/helpers/test-utils.js";
import { Readable } from "stream";
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
import {
  webhookManagerMock,
  alertingMock,
  webhookRateLimiterMock,
  storageHelperMock,
  signatureMock,
  axiosMock,
  ssrfMock,
} from "../setup/helpers/shared-mocks.js";
// ESM mocks must be registered before the module under test is imported.
// LoggerMiddleware will be imported dynamically in beforeAll.

/**
 * @typedef {import('../../src/logger_middleware.js').LoggerMiddleware} LoggerMiddlewareType
 * @typedef {import('../../src/typedefs.js').WebhookData} WebhookData
 */
describe("LoggerMiddleware Complete Coverage", () => {
  /** @type {LoggerMiddlewareType} */
  let middleware;
  /** @type {jest.Mock} */
  let onEvent;
  /** @type {typeof import('../../src/logger_middleware.js').LoggerMiddleware} */
  let LoggerMiddleware;

  useMockCleanup();

  beforeAll(async () => {
    // Explicitly mock consts BEFORE setupCommonMocks to prevent early loading issues
    const { constsMock } = await import("../setup/helpers/shared-mocks.js");
    jest.unstable_mockModule("../../src/consts.js", () => ({
      ...constsMock,
      KVS_OFFLOAD_THRESHOLD: 500, // Force low threshold
      RECURSION_HEADER_NAME: "X-Forwarded-By",
      RECURSION_HEADER_VALUE: "Apify-Webhook-Debugger",
    }));

    await setupCommonMocks({
      logger: true,
      rateLimit: true,
      alerting: true,
      signature: true,
      storage: true,
      apify: true,
      axios: true,
      ssrf: true,
      config: true,
      // consts: false, // We mocked it manually above
    });

    const mod = await import("../../src/logger_middleware.js");
    LoggerMiddleware = mod.LoggerMiddleware;
  });

  beforeEach(() => {
    onEvent = jest.fn();
    middleware = new LoggerMiddleware(webhookManagerMock, {}, onEvent);
    jest.clearAllMocks();

    webhookRateLimiterMock.webhookRateLimiter.check.mockReturnValue({
      allowed: true,
      remaining: 100,
      resetMs: 0,
    });

    signatureMock.verifySignature.mockReturnValue({
      valid: true,
      provider: assertType("test"),
    });
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: true,
      href: "http://safe",
      host: "safe",
    });

    jest.mocked(webhookManagerMock.getWebhookData).mockImplementation(
      /**
       * @param {string} id
       * @returns {WebhookData | undefined}
       */
      (id) => {
        if (id === "wh_none") return undefined;
        return assertType({ id, options: {} });
      },
    );
    jest.mocked(webhookManagerMock.isValid).mockImplementation(
      /**
       * @param {string} id
       * @returns {boolean}
       */
      (id) => id !== "wh_none",
    );

    axiosMock.post.mockResolvedValue({ status: 200, data: {} });
  });

  describe("Core Features", () => {
    test("options getter/setter", () => {
      expect(middleware.options).toBeDefined();
      middleware.updateOptions({ responseDelayMs: 50 });
      expect(middleware.options.responseDelayMs).toBe(50);
    });

    test("resource compilation success", () => {
      middleware.updateOptions({ customScript: "event.test = 1;" });
      expect(middleware.hasCompiledScript()).toBe(true);
      middleware.updateOptions({ jsonSchema: { type: "object" } });
      expect(middleware.hasValidator()).toBe(true);
    });
  });

  describe("Ingest Middleware", () => {
    test("rate limiting (429)", async () => {
      webhookRateLimiterMock.webhookRateLimiter.check.mockReturnValue({
        allowed: false,
        resetMs: 1000,
        remaining: 0,
      });
      const req = createMockRequest({ method: "POST", params: { id: "wh_1" } });
      const res = createMockResponse();
      await middleware.ingestMiddleware(req, res, createMockNextFunction());
      expect(res.status).toHaveBeenCalledWith(429);
    });

    test("large payload rejection (413)", async () => {
      middleware.updateOptions({ maxPayloadSize: 10 });
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: { "content-length": "100" },
      });
      const res = createMockResponse();
      await middleware.ingestMiddleware(req, res, createMockNextFunction());
      expect(res.status).toHaveBeenCalledWith(413);
    });

    test("streaming offload to KVS", async () => {
      const { Actor } = await import("apify");
      jest.mocked(Actor.isAtHome).mockReturnValue(true);
      jest.mocked(Actor.getEnv).mockReturnValue(assertType({ isAtHome: true }));

      const largeSize = 5500000; // > 5MB threshold
      const largeBody = "a".repeat(largeSize);
      middleware.updateOptions({ maxPayloadSize: 10000000 });
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: {
          "content-length": String(largeSize),
          "content-type": "application/json",
        },
      });
      const stream = Readable.from([largeBody]);
      Object.setPrototypeOf(req, stream);
      storageHelperMock.createReferenceBody.mockReturnValue({ $kvs: "key" });

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.ingestMiddleware(req, res, next);

      expect(storageHelperMock.offloadToKvs).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("Main Middleware", () => {
    test("signature verification failure (401)", async () => {
      middleware.updateOptions({
        signatureVerification: { provider: "test", secret: "test" },
      });
      signatureMock.verifySignature.mockReturnValue(
        assertType({
          valid: false,
          error: "Bad sig",
        }),
      );
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        body: {},
      });
      const res = createMockResponse();
      await middleware.middleware(req, res, createMockNextFunction());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test("schema validation failure (400)", async () => {
      middleware.updateOptions({
        jsonSchema: { type: "object", required: ["a"] },
      });
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: { "content-type": "application/json" },
        body: { b: 2 },
      });
      const res = createMockResponse();
      await middleware.middleware(req, res, createMockNextFunction());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("custom script execution", async () => {
      middleware.updateOptions({
        customScript: "event.custom = 'done'; event.responseBody = { ok: 1 };",
      });
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        body: {},
      });
      const res = createMockResponse();
      await middleware.middleware(req, res, createMockNextFunction());
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ custom: "done" }),
      );
      expect(res.json).toHaveBeenCalledWith({ ok: 1 });
    });
  });

  describe("Background Processing", () => {
    test("platform limit error detection", async () => {
      const { Actor } = await import("apify");
      jest
        .mocked(Actor.pushData)
        .mockRejectedValueOnce(new Error("Quota Exceeded"));
      const req = createMockRequest({ method: "POST", params: { id: "wh_1" } });
      await middleware.middleware(
        req,
        createMockResponse(),
        createMockNextFunction(),
      );
      await sleep(100);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ isPlatformError: true }),
        "Platform limit error",
      );
    });

    test("forwarding trigger", async () => {
      middleware.updateOptions({ forwardUrl: "http://forward" });
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        body: { a: 1 },
      });
      await middleware.middleware(
        req,
        createMockResponse(),
        createMockNextFunction(),
      );
      await sleep(100);
      expect(axiosMock.post).toHaveBeenCalled();
    });

    test("SSRF blocking for forwarding", async () => {
      middleware.updateOptions({ forwardUrl: "http://internal" });
      ssrfMock.validateUrlForSsrf.mockResolvedValueOnce({
        safe: false,
        error: "Internal",
      });
      const req = createMockRequest({ method: "POST", params: { id: "wh_1" } });
      await middleware.middleware(
        req,
        createMockResponse(),
        createMockNextFunction(),
      );
      await sleep(100);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });

  describe("Miscellaneous", () => {
    test("non-existent webhooks (404)", async () => {
      const req = createMockRequest({ params: { id: "wh_none" } });
      const res = createMockResponse();
      await middleware.middleware(req, res, createMockNextFunction());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test("JSON parse error in body (400)", async () => {
      middleware.updateOptions({ jsonSchema: { type: "object" } });
      const req = createMockRequest({
        headers: { "content-type": "application/json" },
        body: "{ invalid }",
      });
      const res = createMockResponse();
      await middleware.middleware(req, res, createMockNextFunction());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("background task timeout coverage", async () => {
      alertingMock.triggerAlertIfNeeded.mockReturnValue(
        assertType(new Promise(() => {})),
      );
      middleware.updateOptions({
        alerts: { slack: "http://slack" },
        alertOn: ["2xx"],
      });
      const req = createMockRequest({ method: "POST", params: { id: "wh_1" } });
      const res = createMockResponse();
      await middleware.middleware(req, res, createMockNextFunction());
      // Default response for POST is status 200 and body "OK" via res.send
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith("OK");
    });
  });

  describe("Edge Cases & Error Handling", () => {
    test("should use pre-calculated signature result if present", async () => {
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        body: {},
      });
      /** @type {any} */ (req).ingestSignatureResult = {
        valid: false,
        error: "Pre-validated failure",
        provider: "stream",
      };

      // Enable signature verification to trigger the check
      middleware.updateOptions({
        signatureVerification: { provider: "stream", secret: "test" },
      });

      const res = createMockResponse();
      await middleware.middleware(req, res, createMockNextFunction());
      expect(res.status).toHaveBeenCalledWith(401);

      const jsonMock = jest.mocked(res.json);
      // res.json is called with an object, no need to parse
      expect(jsonMock.mock.calls[0][0].details).toBe("Pre-validated failure");
    });

    test("should handle error after headers sent", async () => {
      const req = createMockRequest({ method: "POST", params: { id: "wh_1" } });
      const res = createMockResponse();
      res.headersSent = true;

      // Let's force throw in `transformRequestData` (private, harder to mock) OR `getSafeResponseDelay`.
      const { configMock } = await import("../setup/helpers/shared-mocks.js");
      jest
        .mocked(configMock.getSafeResponseDelay)
        .mockImplementationOnce(() => {
          throw new Error("Boom");
        });

      res.headersSent = true; // Pre-set headers sent to force the "log error" path

      await middleware.middleware(req, res, createMockNextFunction());
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "Internal middleware error after headers sent",
      );
    });

    test("should fallback to truncation if KVS offload fails", async () => {
      const { Actor } = await import("apify");
      jest.mocked(Actor.isAtHome).mockReturnValue(true);
      jest.mocked(Actor.getEnv).mockReturnValue(assertType({ isAtHome: true }));

      const largeBody = "X".repeat(1000); // 1KB > 500 bytes threshold
      storageHelperMock.offloadToKvs.mockRejectedValueOnce(
        new Error("KVS Failed"),
      );

      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: { "content-type": "application/json" },
        // body must be string to trigger Buffer.byteLength check effectively in middleware for raw usage
        body: largeBody,
      });
      // Mock rawBody to ensure it is picked up
      Object.defineProperty(req, "rawBody", { value: largeBody });

      const res = createMockResponse();

      await middleware.middleware(req, res, createMockNextFunction());

      const sharedMocks = await import("../setup/helpers/shared-mocks.js");
      const apifyMock = sharedMocks.apifyMock;

      // We expect Actor.pushData to be called with a truncated body in the event
      // Note: apifyMock IS the Actor in our mock setup
      expect(apifyMock.pushData).toHaveBeenCalled();
      const lastCall = jest.mocked(apifyMock.pushData).mock.lastCall?.[0];
      expect(lastCall).toEqual(
        expect.objectContaining({
          body: expect.stringContaining("[TRUNCATED_AND_KVS_FAILED]"),
        }),
      );
    });
  });
});
