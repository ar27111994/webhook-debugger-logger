import { jest, describe, test, expect, afterEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";
import { HTTP_STATUS } from "../../src/consts.js";
import {
  useFakeTimers,
  useMockCleanup,
} from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookData} WebhookData
 */

// Mock logger and other dependencies before importing
await setupCommonMocks({ axios: true, apify: true, logger: true });

const { MAX_SAFE_RESPONSE_DELAY_MS: MAX_RESPONSE_DELAY_MS } =
  await import("../../src/consts.js");

describe("Logger Middleware - Response Delay", () => {
  useFakeTimers();
  useMockCleanup();

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("should delay response by requested amount if under limit", async () => {
    const delayMs = 5000;
    const ctx = await createMiddlewareTestContext({
      options: { responseDelayMs: delayMs },
      request: { params: { id: "wh_123" } },
    });

    const middlewarePromise = ctx.middleware(ctx.req, ctx.res, ctx.next);

    // Fast-forward time
    await jest.advanceTimersByTimeAsync(delayMs);

    await middlewarePromise;

    expect(ctx.res.statusCode).toBe(HTTP_STATUS.OK);
    // No warning should be logged for delay under limit
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  test("should cap delay and warn if requested amount exceeds limit (via override)", async () => {
    const ctx = await createMiddlewareTestContext({
      options: { responseDelayMs: 0 },
      request: { params: { id: "wh_override" } },
    });

    // Override getWebhookData for specific test cases
    jest.mocked(ctx.webhookManager.getWebhookData).mockImplementation((id) => {
      if (id === "wh_override")
        return /** @type {WebhookData} */ ({
          responseDelayMs: MAX_RESPONSE_DELAY_MS + 5000,
        });
      return /** @type {WebhookData} */ ({});
    });

    const middlewarePromise = ctx.middleware(ctx.req, ctx.res, ctx.next);

    // Advance by the CAP (10s), which should resolve the delay
    await jest.advanceTimersByTimeAsync(MAX_RESPONSE_DELAY_MS);

    await middlewarePromise;

    expect(ctx.res.statusCode).toBe(HTTP_STATUS.OK);

    // Source uses structured pino logging for clamping warnings
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "responseDelayMs" }),
      expect.stringContaining("exceeds safe max"),
    );
  });
});
