/**
 * @file tests/unit/logger_middleware.test.js
 * @description Comprehensive unit tests for LoggerMiddleware covering all logic paths.
 * Consolidates previous split test files into a single source of truth.
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
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
  sleep,
} from "../setup/helpers/test-utils.js";
import { PassThrough } from "stream";

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  webhookManagerMock,
  webhookRateLimiterMock,
  storageHelperMock,
  signatureMock,
  axiosMock,
  ssrfMock,
  loggerMock,
  mockScriptRun,
  constsMock,
} from "../setup/helpers/shared-mocks.js";

const BACKGROUND_SETTLE_MS = 100;
const TEST_PAYLOAD_SIZE_LARGE = 5500000;
const TEST_MAX_PAYLOAD_LMT = 10000000;

/**
 * @typedef {import('../../src/logger_middleware.js').LoggerMiddleware} LoggerMiddlewareType
 * @typedef {import('../../src/typedefs.js').WebhookData} WebhookData
 * @typedef {import('../../src/typedefs.js').SsrfValidationResult} VerificationResult
 * @typedef {import('../../src/typedefs.js').CustomRequest} Request

 */

describe("LoggerMiddleware Comprehensive", () => {
  /** @type {LoggerMiddlewareType} */
  let middleware;
  /** @type {jest.Mock} */
  let onEvent;
  /** @type {typeof import('../../src/logger_middleware.js').LoggerMiddleware} */
  let LoggerMiddleware;

  useMockCleanup();

  beforeAll(async () => {
    // 1. Register mocks via setupCommonMocks
    await setupCommonMocks({
      axios: true,
      apify: true,
      dns: true,
      ssrf: true,
      logger: true,
      express: true,
      db: true,
      sync: true,
      consts: true,
      webhookManager: true,
      auth: true,
      signature: true,
      rateLimit: true,
      storage: true,
      config: true,
      alerting: true,
      events: true,
      vm: true,
      repositories: true,
      services: true,
      fs: true,
    });

    // 2. Import modules AFTER mocks are established
    const loggerMiddlewareModule =
      await import("../../src/logger_middleware.js");
    LoggerMiddleware = loggerMiddlewareModule.LoggerMiddleware;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    onEvent = jest.fn();
    // Constructor requires: webhookManager, options, onEvent
    middleware = new LoggerMiddleware(webhookManagerMock, {}, onEvent);

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
      href: "https://safe.com",
      host: "safe.com",
    });

    // Reset signature stream mocks to defaults
    signatureMock.createStreamVerifier.mockReturnValue(
      assertType({
        hmac: { update: jest.fn() },
      }),
    );
    signatureMock.finalizeStreamVerification.mockReturnValue(true);

    // Reset storage mocks
    storageHelperMock.generateKvsKey.mockReturnValue("mock-kvs-key");
    storageHelperMock.getKvsUrl.mockResolvedValue(
      "https://api.apify.com/v2/key-value-stores/mock-store/records/mock-kvs-key",
    );
    storageHelperMock.createReferenceBody.mockImplementation((data) => data);
    storageHelperMock.offloadToKvs.mockResolvedValue(undefined);

    jest.mocked(webhookManagerMock.getWebhookData).mockImplementation(
      /**
       * @param {string} id
       * @returns {WebhookData | undefined}
       */
      (id) => {
        if (id === "wh_none") return undefined;
        if (id === "wh_1") {
          return assertType({
            id: "wh_1",
            options: {},
            signatureVerification: {
              provider: "test",
              header: "x-custom-signature",
              secret: "secret",
            },
          });
        }
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

    axiosMock.post.mockResolvedValue({
      status: constsMock.HTTP_STATUS.OK,
      data: {},
    });
  });

  describe("Static Helper: getValidStatusCode", () => {
    test("should return default code for invalid inputs", () => {
      expect(LoggerMiddleware.getValidStatusCode(undefined)).toBe(
        constsMock.HTTP_STATUS.OK,
      );
      expect(LoggerMiddleware.getValidStatusCode("invalid")).toBe(
        constsMock.HTTP_STATUS.OK,
      );
    });

    test("should return default code for out-of-bounds inputs", () => {
      const LOW_CODE = 99;
      const HIGH_CODE = 600;
      expect(LoggerMiddleware.getValidStatusCode(LOW_CODE)).toBe(
        constsMock.HTTP_STATUS.OK,
      );
      expect(LoggerMiddleware.getValidStatusCode(HIGH_CODE)).toBe(
        constsMock.HTTP_STATUS.OK,
      );
    });

    test("should return valid status code", () => {
      expect(
        LoggerMiddleware.getValidStatusCode(constsMock.HTTP_STATUS.CREATED),
      ).toBe(constsMock.HTTP_STATUS.CREATED);
    });
  });

  describe("Core Features & Config", () => {
    test("options getter/setter work correctly", () => {
      expect(middleware.options).toBeDefined();
      const DELAY_MS = 50;
      middleware.updateOptions({ responseDelayMs: DELAY_MS });
      expect(middleware.options.responseDelayMs).toBe(DELAY_MS);
    });

    test("resource compilation success (script & schema)", () => {
      middleware.updateOptions({ customScript: "event.test = 1;" });
      expect(middleware.hasCompiledScript()).toBe(true);
      middleware.updateOptions({ jsonSchema: { type: "object" } });
      expect(middleware.hasValidator()).toBe(true);
    });

    test("resource compilation handles errors gracefully", () => {
      middleware.updateOptions({ customScript: "throw" });
      expect(middleware.hasCompiledScript()).toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorPrefix: expect.stringContaining("SCRIPT"),
        }),
        expect.stringContaining("Invalid"),
      );
    });
  });

  describe("Ingest Middleware", () => {
    test("GET requests should be skipped", async () => {
      const req = createMockRequest({ method: "GET" });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should block recursive forwarding loops", async () => {
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: {
          [constsMock.RECURSION_HEADER_NAME.toLowerCase()]:
            constsMock.RECURSION_HEADER_VALUE,
        },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.ingestMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.UNPROCESSABLE_ENTITY,
      );
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Recursive forwarding loop detected"),
      );
    });

    test("should block recursive forwarding loops (suffixed)", async () => {
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: {
          [constsMock.RECURSION_HEADER_NAME.toLowerCase()]:
            constsMock.RECURSION_HEADER_VALUE +
            constsMock.RECURSION_HEADER_LOOP_SUFFIX,
        },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.ingestMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.UNPROCESSABLE_ENTITY,
      );
    });

    test("rate limiting (429)", async () => {
      webhookRateLimiterMock.webhookRateLimiter.check.mockReturnValue({
        allowed: false,
        resetMs: 1000,
        remaining: 0,
      });
      const req = createMockRequest({ method: "POST", params: { id: "wh_1" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await middleware.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.TOO_MANY_REQUESTS,
      );
    });

    test("large payload rejection (413)", async () => {
      middleware.updateOptions({ maxPayloadSize: 10 });
      const req = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: { "content-length": "100" },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await middleware.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.PAYLOAD_TOO_LARGE,
      );
    });

    test("streaming offload to KVS", async () => {
      const { Actor } = await import("apify");
      jest.mocked(Actor.isAtHome).mockReturnValue(true);
      jest.mocked(Actor.getEnv).mockReturnValue(assertType({ isAtHome: true }));

      const largeSize = 5500000; // > threshold
      const largeBody = "a".repeat(largeSize);
      middleware.updateOptions({ maxPayloadSize: 10000000 });

      // Use proper stream construction
      const reqBase = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: {
          "content-length": String(largeSize),
          "content-type": "application/json",
        },
      });

      const req = new PassThrough();
      Object.assign(req, reqBase);
      req.push(largeBody);
      req.push(null);

      storageHelperMock.createReferenceBody.mockReturnValue({ $kvs: "key" });

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.ingestMiddleware(/** @type {any} */(req), res, next);

      expect(storageHelperMock.offloadToKvs).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      // @ts-expect-error - property added by middleware
      expect(req.isOffloaded).toBe(true);
    });

    test("streaming offload failure handles error gracefully", async () => {
      const largeSize = 5500000;
      middleware.updateOptions({ maxPayloadSize: 10000000 });

      const reqBase = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: { "content-length": String(largeSize) },
      });
      const req = new PassThrough();
      Object.assign(req, reqBase);
      req.push("data");
      req.push(null); // End stream

      // Mock offload failure
      storageHelperMock.offloadToKvs.mockRejectedValue(new Error("KVS Failed"));

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.ingestMiddleware(/** @type {any} */(req), res, next);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Streaming offload failed"),
      );
    });

    test("streaming offload with verification logic", async () => {
      middleware.updateOptions({
        maxPayloadSize: TEST_MAX_PAYLOAD_LMT,
        signatureVerification: { provider: "test", secret: "secret" },
      });

      // Mock createStreamVerifier to return object with hmac having update method
      const mockHmac = {
        update: jest.fn(),
      };
      signatureMock.createStreamVerifier.mockReturnValue({
        hmac: assertType(mockHmac),
        error: undefined,
        expectedSignature: "sig",
        encoding: "hex",
      });
      // Mock finalizeStreamVerification
      signatureMock.finalizeStreamVerification.mockReturnValue(true);

      const reqBase = createMockRequest({
        method: "POST",
        params: { id: "wh_1" },
        headers: {
          "content-length": String(TEST_PAYLOAD_SIZE_LARGE),
          "content-type": constsMock.MIME_TYPES.JSON,
        },
      });

      /** @type {Request} */
      const req = assertType(new PassThrough());
      Object.assign(req, reqBase);

      const res = createMockResponse();
      const next = createMockNextFunction();

      const promise = middleware.ingestMiddleware(req, res, next);

      storageHelperMock.offloadToKvs.mockImplementation((_k, stream) => {
        return new Promise((resolve, reject) => {
          stream.on("end", resolve);
          stream.on("error", reject);
          // Resume the stream to ensure 'end' is emitted if it's a PassThrough
          stream.resume();
        });
      });
      // Emit data properly
      setImmediate(() => {
        req.push(Buffer.from("chunk"));
        req.push(null);
      });

      await promise;

      expect(signatureMock.createStreamVerifier).toHaveBeenCalled();
      expect(req.ingestSignatureResult).toEqual({
        valid: true,
        provider: "test",
        error: undefined,
      });
    });
  });

  describe("Main Middleware", () => {
    test("signature verification failure (HTTP_STATUS.UNAUTHORIZED)", async () => {
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
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.UNAUTHORIZED,
      );
    });

    test("schema validation failure (400)", async () => {
      middleware.updateOptions({
        jsonSchema: { type: "object", required: ["a"] },
      });
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        headers: { "content-type": constsMock.MIME_TYPES.JSON },
        body: { b: 2 },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.BAD_REQUEST,
      );
    });

    test("custom script execution", async () => {
      middleware.updateOptions({
        customScript:
          "console.log('test'); event.custom = 'done'; event.responseBody = { ok: 1 };",
      });
      mockScriptRun.mockImplementation((/** @type {any} */ context) => {
        // For custom script tests
        if (context.event) {
          context.console.log("Wrapper Test");
          context.event.custom = "done";
          context.event.responseBody = { ok: 1 };
        }
      });
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        body: {},
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: "wh_1" }),
      );
      expect(res.json).toHaveBeenCalledWith({ ok: 1 });
      // Assert limitedConsole log mapped to loggerMock.debug
      expect(loggerMock.debug).toHaveBeenCalledWith(
        expect.objectContaining({ source: "script" }),
        "Wrapper Test",
      );
    });
  });

  describe("Data Transformation Coverage", () => {
    test("should mask headers", async () => {
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        headers: {
          [constsMock.HTTP_HEADERS.AUTHORIZATION]: "secret",
          [constsMock.HTTP_HEADERS.X_API_KEY]: "secret",
          "public-header": "public",
        },
        body: {},
      });
      // Default options include masking

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: expect.stringContaining("MASKED"),
            "public-header": "public",
          }),
        }),
      );
    });

    test("should redact body fields", async () => {
      middleware.updateOptions({ redactBodyPaths: ["body.sensitive"] });
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        headers: { "content-type": constsMock.MIME_TYPES.JSON },
        body: { sensitive: "secret", public: "value" },
      });

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("[REDACTED]"),
        }),
      );
    });

    test("should handle binary buffer body", async () => {
      const binBody = Buffer.from("test");
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        headers: { "content-type": constsMock.MIME_TYPES.OCTET_STREAM },
        body: binBody,
      });

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          body: binBody.toString("base64"),
          bodyEncoding: "base64",
        }),
      );
    });

    test("should sync offload large payloads (if ingestion skipped it)", async () => {
      // Use size larger than STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD (5MB)
      const hugeString = "a".repeat(TEST_PAYLOAD_SIZE_LARGE);
      storageHelperMock.offloadToKvs.mockResolvedValue(undefined);
      storageHelperMock.createReferenceBody.mockReturnValue({
        $kvs: "sync_key",
      });

      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        headers: { "content-type": constsMock.MIME_TYPES.TEXT_PLAIN },
        body: hugeString,
      });

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);

      expect(storageHelperMock.offloadToKvs).toHaveBeenCalled();
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ $kvs: "sync_key" }),
        }),
      );
    });

    test("should handle sync offload failure", async () => {
      // Use size larger than STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD (5MB)
      const hugeString = "a".repeat(TEST_PAYLOAD_SIZE_LARGE);
      storageHelperMock.offloadToKvs.mockRejectedValue(new Error("KVS Error"));
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        headers: { "content-type": constsMock.MIME_TYPES.TEXT_PLAIN },
        body: hugeString,
      });

      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("offload large payload"),
      );
      // Check truncation logic
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("TRUNCATED"),
        }),
      );
    });
  });

  describe("Background Processing", () => {
    test("platform limit error detection", async () => {
      const { Actor } = await import("apify");
      jest
        .mocked(Actor.pushData)
        .mockRejectedValueOnce(new Error("Quota Exceeded"));
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      await sleep(BACKGROUND_SETTLE_MS);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ isPlatformError: true }),
        "Platform limit error",
      );
    });

    test("forwarding trigger", async () => {
      middleware.updateOptions({ forwardUrl: "https://forward.com" });
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
        body: { a: 1 },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      await sleep(BACKGROUND_SETTLE_MS);
      const { forwardingServiceMock } =
        await import("../setup/helpers/shared-mocks.js");
      expect(forwardingServiceMock.forwardWebhook).toHaveBeenCalled();
    });

    test("SSRF blocking for forwarding", async () => {
      middleware.updateOptions({ forwardUrl: "https://internal.com" });
      ssrfMock.validateUrlForSsrf.mockResolvedValueOnce({
        safe: false,
        error: "Internal",
      });
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      await sleep(BACKGROUND_SETTLE_MS);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases & Error Handling", () => {
    test("non-existent webhooks (404)", async () => {
      const req = createMockRequest({ params: { id: "wh_none" } });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.NOT_FOUND);
    });

    test("JSON parse error in body (HTTP_STATUS.BAD_REQUEST)", async () => {
      const EXPECTED_STATUS = constsMock.HTTP_STATUS.BAD_REQUEST;
      middleware.updateOptions({ jsonSchema: { type: "object" } });
      const req = createMockRequest({
        headers: { "content-type": constsMock.MIME_TYPES.JSON },
        body: "{ invalid }",
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(EXPECTED_STATUS);
    });

    test("should use pre-calculated signature result if present", async () => {
      /** @type {Request} */
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
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
      const next = createMockNextFunction();
      await middleware.middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.UNAUTHORIZED,
      );

      const jsonMock = jest.mocked(res.json);
      expect(jsonMock.mock.calls[0][0].details).toBe("Pre-validated failure");
    });

    test("should handle error after headers sent", async () => {
      const req = createMockRequest({
        method: constsMock.HTTP_METHODS.POST,
        params: { id: "wh_1" },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();
      res.headersSent = true;

      const { configMock } = await import("../setup/helpers/shared-mocks.js");
      jest
        .mocked(configMock.getSafeResponseDelay)
        .mockImplementationOnce(() => {
          throw new Error("Boom");
        });

      await middleware.middleware(req, res, next);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "Internal middleware error after headers sent",
      );
    });
  });
});
