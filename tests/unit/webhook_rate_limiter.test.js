import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { sleep } from "../setup/helpers/test-utils.js";

// Mock consts
jest.unstable_mockModule("../../src/consts.js", () => ({
  DEFAULT_RATE_LIMIT_WINDOW_MS: 1000,
  DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE: 5,
  DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES: 10,
  MAX_SAFE_RATE_LIMIT_PER_MINUTE: 1000,
}));

// Import class under test
const { WebhookRateLimiter } =
  await import("../../src/utils/webhook_rate_limiter.js");

/**
 * @typedef {import('../../src/utils/webhook_rate_limiter.js').WebhookRateLimiter} WebhookRateLimiter
 */

describe("WebhookRateLimiter", () => {
  /** @type {WebhookRateLimiter} */
  let rateLimiter;

  beforeEach(() => {
    // Create new instance for each test with controlled defaults
    rateLimiter = new WebhookRateLimiter(5, 1000, 10);
  });

  afterEach(() => {
    rateLimiter.destroy();
  });

  test("should allow requests under limit", () => {
    const webhookId = "wh_123";
    for (let i = 0; i < 5; i++) {
      const result = rateLimiter.check(webhookId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - 1 - i);
    }
  });

  test("should block requests over limit", () => {
    const webhookId = "wh_123";
    // Consume limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(webhookId);
    }

    // Next request should fail
    const result = rateLimiter.check(webhookId);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetMs).toBeGreaterThan(0);
  });

  test("should reset after window", async () => {
    const webhookId = "wh_123";
    // Short window for testing
    const shortLimiter = new WebhookRateLimiter(5, 100, 10);

    // Consume limit
    for (let i = 0; i < 5; i++) {
      shortLimiter.check(webhookId);
    }
    expect(shortLimiter.check(webhookId).allowed).toBe(false);

    // Wait for window
    await sleep(150);

    // Should be allowed again
    expect(shortLimiter.check(webhookId).allowed).toBe(true);
    shortLimiter.destroy();
  });

  test("should treat different IPs for same webhook as separate entries if IP provided", () => {
    const webhookId = "wh_123";
    const ip1 = "1.1.1.1";
    const ip2 = "2.2.2.2";

    // Consume limit for ip1
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(webhookId, ip1);
    }
    expect(rateLimiter.check(webhookId, ip1).allowed).toBe(false);

    // ip2 should still be allowed (composite key verification)
    expect(rateLimiter.check(webhookId, ip2).allowed).toBe(true);
  });

  test("should enforce maxEntries", () => {
    const limiter = new WebhookRateLimiter(5, 1000, 2); // Max 2 entries

    limiter.check("wh_1");
    limiter.check("wh_2");
    expect(limiter.entryCount).toBe(2);

    // Adding 3rd should evict one (LRU)
    limiter.check("wh_3");
    expect(limiter.entryCount).toBe(2);

    // Verify wh_1 state is gone (conceptually, though check() re-initializes it essentially)
    limiter.destroy();
  });

  test("should validate constructor constraints", () => {
    expect(() => new WebhookRateLimiter(-1)).toThrow();
    expect(() => new WebhookRateLimiter(10, -1)).toThrow();
    expect(() => new WebhookRateLimiter(10, 1000, 0)).toThrow();
  });
});
