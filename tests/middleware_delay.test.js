import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

/** @typedef {import('../src/webhook_manager.js').WebhookManager} WebhookManager */

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const { createLoggerMiddleware } = await import("../src/logger_middleware.js");
const { MAX_RESPONSE_DELAY_MS } = await import("../src/consts.js");
const httpMocks = (await import("node-mocks-http")).default;

describe("Logger Middleware - Response Delay", () => {
  /** @type {WebhookManager} */
  let webhookManager;
  /** @type {jest.Mock} */
  let onEvent;

  beforeEach(() => {
    jest.useFakeTimers();
    webhookManager = /** @type {WebhookManager} */ ({
      isValid: jest.fn().mockReturnValue(true),
      getWebhookData: jest.fn().mockReturnValue({}),
    });
    onEvent = jest.fn();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("should delay response by requested amount if under limit", async () => {
    const delayMs = 5000;
    const options = { responseDelayMs: delayMs };
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);

    const req = httpMocks.createRequest({ params: { id: "wh_123" } });
    const res = httpMocks.createResponse();

    const middlewarePromise = middleware(req, res);

    // Fast-forward time
    jest.advanceTimersByTime(delayMs);

    await middlewarePromise;

    expect(res.statusCode).toBe(200);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("should cap delay and warn if requested amount exceeds limit", async () => {
    const requestedDelay = MAX_RESPONSE_DELAY_MS + 5000; // 15s if limit is 10s
    const options = { responseDelayMs: requestedDelay };
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);

    const req = httpMocks.createRequest({ params: { id: "wh_123" } });
    const res = httpMocks.createResponse();

    const middlewarePromise = middleware(req, res);

    // Advance by the CAP (10s), which should resolve the delay
    jest.advanceTimersByTime(MAX_RESPONSE_DELAY_MS);

    await middlewarePromise;

    expect(res.statusCode).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`capped at ${MAX_RESPONSE_DELAY_MS}ms`)
    );
  });
});
