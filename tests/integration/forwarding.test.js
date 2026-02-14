import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import {
  waitForCondition,
  getLastAxiosConfig,
  assertType,
} from "../setup/helpers/test-utils.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";

// Mock Apify, Axios, and Logger
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({
  axios: true,
  apify: true,
  dns: true,
  ssrf: true,
  logger: true,
});
import { ssrfMock, loggerMock } from "../setup/helpers/shared-mocks.js";
import {
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
  HTTP_STATUS,
  HTTP_HEADERS,
  MIME_TYPES,
} from "../../src/consts/index.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";
const axios = (await import("axios")).default;
const { Actor } = await import("apify");

/**
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 */

describe("Forwarding Security", () => {
  useMockCleanup();

  test("should strip sensitive headers when forwarding even if forwardHeaders is true", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        forwardUrl: "http://target.com/ingest",
        forwardHeaders: true,
        authKey: "secret",
      },
      request: {
        params: { id: "wh_123" },
        headers: {
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          [HTTP_HEADERS.AUTHORIZATION]: "Bearer secret",
          [HTTP_HEADERS.COOKIE]: "session=123",
          [HTTP_HEADERS.X_API_KEY]: "my-key",
          [HTTP_HEADERS.USER_AGENT]: "test-agent",
        },
        body: { foo: "bar" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    const config = getLastAxiosConfig(axios);
    expect(config).toBeDefined();

    const sentHeaders = /** @type {Record<string, string>} */ (config.headers);
    expect(sentHeaders[HTTP_HEADERS.AUTHORIZATION]).toBeUndefined();
    expect(sentHeaders[HTTP_HEADERS.COOKIE]).toBeUndefined();
    expect(sentHeaders[HTTP_HEADERS.X_API_KEY]).toBeUndefined();
    expect(sentHeaders[HTTP_HEADERS.USER_AGENT]).toBe("test-agent");
    expect(sentHeaders[RECURSION_HEADER_NAME]).toBe(RECURSION_HEADER_VALUE);
  });

  test("should strip almost all headers if forwardHeaders is false", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        forwardUrl: "http://target.com/ingest",
        forwardHeaders: false,
        authKey: "secret",
      },
      request: {
        params: { id: "wh_123" },
        headers: {
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          [HTTP_HEADERS.AUTHORIZATION]: "Bearer secret",
          [HTTP_HEADERS.CONTENT_LENGTH]: "15",
          [HTTP_HEADERS.USER_AGENT]: "test-agent",
          "x-custom": "value",
        },
        body: { foo: "bar" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    const config = getLastAxiosConfig(axios);
    const sentHeaders = /** @type {Record<string, string>} */ (config.headers);

    expect(sentHeaders[HTTP_HEADERS.CONTENT_TYPE]).toBe(MIME_TYPES.JSON);
    expect(sentHeaders[HTTP_HEADERS.CONTENT_LENGTH]).toBeUndefined();
    expect(sentHeaders[HTTP_HEADERS.USER_AGENT]).toBeUndefined();
    expect(sentHeaders["x-custom"]).toBeUndefined();
    expect(sentHeaders[RECURSION_HEADER_NAME]).toBe(RECURSION_HEADER_VALUE);
  });

  test("should mask sensitive headers in captured event if maskSensitiveData is true", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        forwardUrl: "http://target.com/ingest",
        forwardHeaders: true,
        authKey: "secret",
        maskSensitiveData: true,
      },
      request: {
        params: { id: "wh_123" },
        headers: {
          [HTTP_HEADERS.AUTHORIZATION]: "Bearer secret",
          [HTTP_HEADERS.COOKIE]: "session=123",
          [HTTP_HEADERS.X_API_KEY]: "my-key",
          [HTTP_HEADERS.USER_AGENT]: "test-agent",
        },
        body: {},
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(HTTP_STATUS.OK);
    // Explicitly assert that pushData was invoked before accessing mock.calls
    expect(Actor.pushData).toHaveBeenCalled();

    const pushedData = /** @type {WebhookEvent} */ (
      jest.mocked(Actor.pushData).mock.calls[0][0]
    );

    expect(pushedData.headers[HTTP_HEADERS.AUTHORIZATION]).toBe("[MASKED]");
    expect(pushedData.headers[HTTP_HEADERS.COOKIE]).toBe("[MASKED]");
    expect(pushedData.headers[HTTP_HEADERS.X_API_KEY]).toBe("[MASKED]");
    expect(pushedData.headers[HTTP_HEADERS.USER_AGENT]).toBe("test-agent");
  });

  test("should handle missing forwardUrl gracefully (no forwarding)", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        // forwardUrl explicitly undefined/deleted
        authKey: "secret",
      },
      request: {
        params: { id: "wh_123" },
        headers: {},
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(axios.post).not.toHaveBeenCalled();
  });

  test("should block forwarding to internal IP (SSRF)", async () => {
    // Override mock to return unsafe for this test
    const { SSRF_ERRORS } = await import("../../src/consts/index.js");
    ssrfMock.validateUrlForSsrf.mockResolvedValueOnce({
      safe: false,
      error: SSRF_ERRORS.INTERNAL_IP,
    });

    const ctx = await createMiddlewareTestContext({
      options: {
        forwardUrl: "http://127.0.0.1/admin",
        authKey: "secret",
      },
      request: {
        params: { id: "wh_ssrf" },
        headers: { [HTTP_HEADERS.AUTHORIZATION]: "Bearer secret" },
        body: { data: "test" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    // Trigger background tasks by simulating response finish
    ctx.res.emit("finish");

    // Wait for the error to be logged via structured logger
    await waitForCondition(
      () => loggerMock.error.mock.calls.length > 0,
      1000,
      10,
    );

    expect(axios.post).not.toHaveBeenCalled();
    // Source uses structured pino logging via log.error
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: SSRF_ERRORS.INTERNAL_IP }),
      LOG_MESSAGES.SSRF_BLOCKED,
    );
  });

  describe("Forwarding Retries & Error Handling", () => {
    beforeEach(() => {
      jest.setTimeout(30000);
    });

    test("should retry transient errors (ECONNABORTED) and log failure", async () => {
      // Mock failure
      const error = new Error("Timeout");
      /** @type {CommonError} */ (error).code = "ECONNABORTED";
      jest.mocked(axios.post).mockRejectedValue(error);

      const ctx = await createMiddlewareTestContext({
        options: {
          forwardUrl: "http://target.com/retry",
          authKey: "secret",
        },
        request: {
          params: { id: "wh_retry" },
          body: { data: "test" },
          headers: { [HTTP_HEADERS.AUTHORIZATION]: "Bearer secret" },
        },
      });

      // No fake timers - rely on short axios-retry delay (1s, 2s)
      await ctx.middleware(ctx.req, ctx.res, ctx.next);

      await waitForCondition(
        () => jest.mocked(axios.post).mock.calls.length === 3,
        4000,
        100,
      );

      // 3 calls total (1 initial + 2 retries)
      expect(axios.post).toHaveBeenCalledTimes(3);

      // Verify error log push
      const calls = jest.mocked(Actor.pushData).mock.calls;
      const errorLog = calls.find(
        (c) =>
          assertType(c[0]).type === "Forward Error" &&
          assertType(c[0]).statusCode === HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(errorLog).toBeDefined();
    }, 30000);

    test("should NOT retry non-transient errors", async () => {
      const error = new Error("Bad Request");
      /** @type {CommonError} */ (error).response = {
        status: HTTP_STATUS.BAD_REQUEST,
      };
      jest.mocked(axios.post).mockRejectedValue(error);

      const ctx = await createMiddlewareTestContext({
        options: {
          forwardUrl: "http://target.com/fail",
          authKey: "secret",
        },
        request: {
          params: { id: "wh_fail_fast" },
          body: {},
          headers: { [HTTP_HEADERS.AUTHORIZATION]: "Bearer secret" },
        },
      });

      await ctx.middleware(ctx.req, ctx.res, ctx.next);

      expect(axios.request).toHaveBeenCalledTimes(1);
    });
  });

  describe("Platform Limits Handling", () => {
    test("should catch and log platform limit errors", async () => {
      // Logic that triggers Actor.pushData failure
      jest
        .mocked(Actor.pushData)
        .mockRejectedValue(new Error("Dataset quota exceeded"));

      const ctx = await createMiddlewareTestContext({
        options: {
          forwardUrl: "http://target.com/limit",
          authKey: "secret",
        },
        request: {
          params: { id: "wh_limit" },
          body: {},
          headers: { [HTTP_HEADERS.AUTHORIZATION]: "Bearer secret" },
        },
      });

      // Should not throw
      await ctx.middleware(ctx.req, ctx.res, ctx.next);

      // Source uses structured pino logging via log.error
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          isPlatformError: true,
          err: expect.objectContaining({ message: "Dataset quota exceeded" }),
        }),
        LOG_MESSAGES.PLATFORM_LIMIT_ERROR,
      );
    });
  });
});
