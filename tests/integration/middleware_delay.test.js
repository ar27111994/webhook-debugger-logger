import { jest, describe, test, expect, afterEach } from "@jest/globals";
import { useConsoleSpy } from "../setup/helpers/test-lifecycle.js";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";
import { useFakeTimers } from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookData} WebhookData
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true });

const { MAX_SAFE_RESPONSE_DELAY_MS: MAX_RESPONSE_DELAY_MS } =
  await import("../../src/consts.js");

describe("Logger Middleware - Response Delay", () => {
  useFakeTimers();
  useConsoleSpy("warn");

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

    expect(ctx.res.statusCode).toBe(200);
    expect(console.warn).not.toHaveBeenCalled();
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

    expect(ctx.res.statusCode).toBe(200);

    // With run-to-completion semantics for promises + fake timers,
    // ensure all microtasks are flushed.
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Clamping to limit"),
    );
  });
});
