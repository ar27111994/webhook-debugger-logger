/**
 * @file tests/unit/logger_middleware.test.js
 * @description Unit tests for LoggerMiddleware core logic.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  useMockCleanup,
  useFakeTimers,
} from "../setup/helpers/test-lifecycle.js";
import {
  HTTP_HEADERS,
  HTTP_STATUS,
  HTTP_METHODS,
  MIME_TYPES,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
} from "../../src/consts/http.js";
import { ERROR_MESSAGES } from "../../src/consts/errors.js";
import {
  assertType,
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";
import { APP_CONSTS } from "../../src/consts/app.js";

/**
 * @typedef {import('../../src/logger_middleware.js').LoggerMiddleware} LoggerMiddleware
 */

await setupCommonMocks({
  apify: true,
  logger: true,
  repositories: true,
});

// Import dynamically to get mocked modules
const { loggerMock, webhookManagerMock, forwardingServiceMock } =
  await import("../setup/helpers/shared-mocks.js");

const { LoggerMiddleware, createLoggerMiddleware } =
  await import("../../src/logger_middleware.js");
const { appEvents, EVENT_NAMES } = await import("../../src/utils/events.js");
const { webhookRateLimiter } =
  await import("../../src/utils/webhook_rate_limiter.js");

// Helper to construct express request/response objects
function createMockExpress() {
  const req = createMockRequest({
    method: HTTP_METHODS.POST,
    params: { id: "wh_test_123" },
    headers: {
      [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
      [HTTP_HEADERS.CONTENT_LENGTH]: "100",
    },
    body: { test: "payload" },
    query: {},
    ip: "127.0.0.1",
    url: "/api/v1/wh_test_123",
    originalUrl: "/api/v1/wh_test_123",
    socket: assertType({ remoteAddress: "127.0.0.1" }),
    pipe: assertType(jest.fn()),
    on: assertType(jest.fn()),
  });

  const res = createMockResponse(
    assertType({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      headersSent: false,
    }),
  );

  const next = createMockNextFunction();
  return { req, res, next };
}

describe("LoggerMiddleware", () => {
  useMockCleanup();
  useFakeTimers();

  /** @type {jest.Mock} */
  let onEventMock;

  beforeEach(() => {
    onEventMock = jest.fn();
    jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);
    jest
      .mocked(webhookManagerMock.getWebhookData)
      .mockReturnValue(assertType({}));
    jest
      .spyOn(webhookRateLimiter, "check")
      .mockReturnValue({ allowed: true, remaining: 99, resetMs: 1000 });
    jest.spyOn(appEvents, "emit").mockImplementation(assertType(() => {}));

    // Suppress expected log noise
    loggerMock.info.mockClear();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.debug.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Instantiation & Options", () => {
    it("should correctly create and assign options", () => {
      const rawOptions = { defaultResponseCode: HTTP_STATUS.ACCEPTED };
      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        rawOptions,
        onEventMock,
        forwardingServiceMock,
      );
      expect(middleware.options.defaultResponseCode).toBe(HTTP_STATUS.ACCEPTED);
      expect(middleware.hasCompiledScript()).toBe(false);
      expect(middleware.hasValidator()).toBe(false);
    });

    it("should compile scripts dynamically if provided", () => {
      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        { customScript: `event.statusCode = ${HTTP_STATUS.CREATED};` },
        onEventMock,
        forwardingServiceMock,
      );
      expect(middleware.hasCompiledScript()).toBe(true);
    });

    it("factory pattern exports correctly configured middleware object", () => {
      const middlewareFn = createLoggerMiddleware(
        webhookManagerMock,
        {},
        onEventMock,
      );
      expect(typeof middlewareFn).toBe("function");
      expect(typeof middlewareFn.updateOptions).toBe("function");
    });
  });

  describe("ingestMiddleware", () => {
    /** @type {LoggerMiddleware} */
    let middlewareInstance;
    beforeEach(() => {
      middlewareInstance = new LoggerMiddleware(
        webhookManagerMock,
        {},
        onEventMock,
        forwardingServiceMock,
      );
    });

    it("should bypass GET/HEAD requests immediately", async () => {
      const { req, res, next } = createMockExpress();
      req.method = HTTP_METHODS.GET;
      await middlewareInstance.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(webhookRateLimiter.check).not.toHaveBeenCalled();
    });

    it("should block recursive loop requests", async () => {
      const { req, res, next } = createMockExpress();
      req.headers[RECURSION_HEADER_NAME] = RECURSION_HEADER_VALUE;

      await middlewareInstance.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: ERROR_MESSAGES.RECURSIVE_FORWARDING,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should block requests over max size limits dynamically", async () => {
      const mw = new LoggerMiddleware(
        webhookManagerMock,
        { maxPayloadSize: 100 },
        onEventMock,
        forwardingServiceMock,
      );
      const { req, res, next } = createMockExpress();
      req.headers[HTTP_HEADERS.CONTENT_LENGTH] = "200"; // Exceeds size 100

      await mw.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.PAYLOAD_TOO_LARGE);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle rate limiting gracefully", async () => {
      const resetMs = 5000;
      const { req, res, next } = createMockExpress();
      jest
        .mocked(webhookRateLimiter.check)
        .mockReturnValue({ allowed: false, remaining: 0, resetMs });

      await middlewareInstance.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.TOO_MANY_REQUESTS);
      expect(res.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.RETRY_AFTER,
        resetMs / APP_CONSTS.MS_PER_SECOND,
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("middleware execution (main logic)", () => {
    /** @type {LoggerMiddleware} */
    let mw;
    beforeEach(() => {
      mw = new LoggerMiddleware(
        webhookManagerMock,
        {
          defaultResponseCode: HTTP_STATUS.OK,
          defaultResponseBody: { ok: true },
        },
        onEventMock,
        forwardingServiceMock,
      );
    });

    it("should reject invalid webhooks with 404", async () => {
      jest.mocked(webhookManagerMock.isValid).mockReturnValue(false);
      const { req, res, next } = createMockExpress();

      await mw.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: ERROR_MESSAGES.WEBHOOK_NOT_FOUND }),
      );
    });

    it("should execute basic flow and emit events without error", async () => {
      const { req, res, next } = createMockExpress();

      await mw.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(res.json).toHaveBeenCalledWith({ ok: true });

      // Advance timers to trigger background promises in race conditions
      await jest.runAllTimersAsync();

      expect(appEvents.emit).toHaveBeenCalledWith(
        EVENT_NAMES.LOG_RECEIVED,
        expect.any(Object),
      );
      expect(onEventMock).toHaveBeenCalled();
    });

    it("should validate schemas returning 400 if mismatch", async () => {
      const strictMw = new LoggerMiddleware(
        webhookManagerMock,
        {
          jsonSchema: { type: "object", required: ["mandatory"] },
        },
        onEventMock,
        forwardingServiceMock,
      );

      const { req, res, next } = createMockExpress();
      req.body = { test: "payload_without_mandatory" }; // Mismatch

      await strictMw.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    });

    it("should run custom transformation scripts cleanly", async () => {
      const payload = "payload_modified";
      const scriptMw = new LoggerMiddleware(
        webhookManagerMock,
        {
          customScript: `event.statusCode = ${HTTP_STATUS.ACCEPTED}; event.responseBody = { test_custom: req.body.test };`,
        },
        onEventMock,
        forwardingServiceMock,
      );

      const { req, res, next } = createMockExpress();
      req.body = { test: payload };

      await scriptMw.middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.ACCEPTED);
      expect(res.json).toHaveBeenCalledWith({ test_custom: payload });
    });

    it("should trigger webhook forwarding natively", async () => {
      const fwdUrl = "https://forward.test";
      const fwdMw = new LoggerMiddleware(
        webhookManagerMock,
        {
          forwardUrl: fwdUrl,
        },
        onEventMock,
        forwardingServiceMock,
      );

      const { req, res, next } = createMockExpress();

      await fwdMw.middleware(req, res, next);
      await jest.runAllTimersAsync();

      expect(forwardingServiceMock.forwardWebhook).toHaveBeenCalledWith(
        expect.any(Object), // event
        req,
        expect.any(Object), // options
        fwdUrl,
        expect.any(AbortSignal), // Controller signal
      );
    });
  });
});
