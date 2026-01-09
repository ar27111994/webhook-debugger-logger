import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

jest.unstable_mockModule("dns/promises", async () => {
  const { dnsPromisesMock } = await import("./helpers/shared-mocks.js");
  return { default: dnsPromisesMock };
});

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const { createLoggerMiddleware } = await import("../src/logger_middleware.js");
const httpMocks = (await import("node-mocks-http")).default;
const axios = (await import("axios")).default;
const { Actor } = await import("apify");

describe("Forwarding Security", () => {
  /** @type {import('../src/webhook_manager.js').WebhookManager} */
  let webhookManager;
  /** @type {import('../src/typedefs.js').LoggerOptions} */
  let options;
  /** @type {jest.Mock} */
  let onEvent;

  beforeEach(() => {
    webhookManager = /** @type {any} */ ({
      isValid: jest.fn().mockReturnValue(true),
      getWebhookData: jest.fn().mockReturnValue({}),
    });
    onEvent = jest.fn();
    options = {
      forwardUrl: "http://target.com/ingest",
      forwardHeaders: true,
      authKey: "secret",
    };
    jest.clearAllMocks();
  });

  test("should strip sensitive headers when forwarding even if forwardHeaders is true", async () => {
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
        cookie: "session=123",
        "x-api-key": "my-key",
        "user-agent": "test-agent",
      },
      body: { foo: "bar" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    /** @type {any} */
    const axiosCall = jest.mocked(axios.post).mock.calls[0];
    expect(axiosCall).toBeDefined();

    /** @type {Object.<string, string>} */
    const sentHeaders = axiosCall[2].headers;
    expect(sentHeaders["authorization"]).toBeUndefined();
    expect(sentHeaders["cookie"]).toBeUndefined();
    expect(sentHeaders["x-api-key"]).toBeUndefined();
    expect(sentHeaders["user-agent"]).toBe("test-agent");
    expect(sentHeaders["X-Forwarded-By"]).toBe("Apify-Webhook-Debugger");
  });

  test("should strip almost all headers if forwardHeaders is false", async () => {
    options.forwardHeaders = false;
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
        "content-length": "15",
        "user-agent": "test-agent",
        "x-custom": "value",
      },
      body: { foo: "bar" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    /** @type {any} */
    const axiosCall = jest.mocked(axios.post).mock.calls[0];
    /** @type {Object.<string, string>} */
    const sentHeaders = axiosCall[2].headers;

    expect(sentHeaders["content-type"]).toBe("application/json");
    // content-length is NOT forwarded - axios auto-calculates it per HTTP spec
    expect(sentHeaders["content-length"]).toBeUndefined();
    expect(sentHeaders["user-agent"]).toBeUndefined();
    expect(sentHeaders["x-custom"]).toBeUndefined();
    expect(sentHeaders["X-Forwarded-By"]).toBe("Apify-Webhook-Debugger");
  });

  test("should mask sensitive headers in captured event if maskSensitiveData is true", async () => {
    options.maskSensitiveData = true;
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      headers: {
        authorization: "Bearer secret",
        cookie: "session=123",
        "x-api-key": "my-key",
        "user-agent": "test-agent",
      },
      body: {},
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(200);
    // Explicitly assert that pushData was invoked before accessing mock.calls
    expect(Actor.pushData).toHaveBeenCalled();

    const pushedData = /** @type {any} */ (
      jest.mocked(Actor.pushData).mock.calls[0][0]
    );

    expect(pushedData.headers["authorization"]).toBe("[MASKED]");

    expect(pushedData.headers["cookie"]).toBe("[MASKED]");

    expect(pushedData.headers["x-api-key"]).toBe("[MASKED]");

    expect(pushedData.headers["user-agent"]).toBe("test-agent");
  });

  test("should handle missing forwardUrl gracefully (no forwarding)", async () => {
    delete options.forwardUrl;
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      headers: {},
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(axios.post).not.toHaveBeenCalled();
  });

  describe("Forwarding Retries & Error Handling", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("should retry transient errors (ECONNABORTED) and log failure", async () => {
      // Mock failure
      const error = new Error("Timeout");

      /** @type {any} */ (error).code = "ECONNABORTED";
      jest.mocked(axios.post).mockRejectedValue(error);

      const middleware = createLoggerMiddleware(
        webhookManager,
        options,
        onEvent,
      );
      const req = httpMocks.createRequest({
        params: { id: "wh_retry" },
        body: { data: "test" },
        headers: { authorization: "Bearer secret" },
      });
      const res = httpMocks.createResponse();

      const p = middleware(req, res);

      // Advance timers to trigger retries
      // We expect 3 attempts (initial + 2 retries) with delays 1s, 2s
      await jest.runAllTimersAsync();
      await p;

      // 3 calls total (1 initial + 2 retries)
      expect(axios.post).toHaveBeenCalledTimes(3);

      // Verify error log push
      const calls = jest.mocked(Actor.pushData).mock.calls;
      const errorLog = calls.find(
        (c) =>
          /** @type {any} */ (c[0]).type === "forward_error" &&
          /** @type {any} */ (c[0]).statusCode === 500,
      );
      expect(errorLog).toBeDefined();
    });

    test("should NOT retry non-transient errors", async () => {
      const error = new Error("Bad Request");

      /** @type {any} */ (error).response = { status: 400 };
      jest.mocked(axios.post).mockRejectedValue(error);

      const middleware = createLoggerMiddleware(
        webhookManager,
        options,
        onEvent,
      );
      const req = httpMocks.createRequest({
        params: { id: "wh_fail_fast" },
        body: {},
        headers: { authorization: "Bearer secret" },
      });
      const res = httpMocks.createResponse();

      await middleware(req, res);

      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe("Platform Limits Handling", () => {
    test("should catch and log platform limit errors", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Logic that triggers Actor.pushData failure
      jest
        .mocked(Actor.pushData)
        .mockRejectedValue(new Error("Dataset quota exceeded"));

      const middleware = createLoggerMiddleware(
        webhookManager,
        options,
        onEvent,
      );
      const req = httpMocks.createRequest({
        params: { id: "wh_limit" },
        body: {},
        headers: { authorization: "Bearer secret" },
      });
      const res = httpMocks.createResponse();

      // Should not throw
      await middleware(req, res);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("PLATFORM-LIMIT"),
        expect.stringContaining("Dataset quota exceeded"),
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
