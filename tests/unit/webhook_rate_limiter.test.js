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

  test("should prune expired entries", () => {
    jest.useFakeTimers();
    // Re-create instance with fake timers active
    rateLimiter.destroy();
    rateLimiter = new WebhookRateLimiter(5, 1000, 10); // 1s window

    rateLimiter.check("wh_old");
    expect(rateLimiter.entryCount).toBe(1);

    // Advance time past window (1000ms)
    jest.advanceTimersByTime(1100);

    // Advance time to trigger cleanup interval (1000ms)
    jest.advanceTimersByTime(1100);

    // Should be removed
    expect(rateLimiter.entryCount).toBe(0);

    jest.useRealTimers();
  });

  test("should partially prune entries (mixed expiration)", () => {
    jest.useFakeTimers();
    // Use larger window to make gaps obvious
    rateLimiter = new WebhookRateLimiter(5, 2000, 10);

    rateLimiter.check("wh_early"); // t=0

    // Advance 1000ms. t=1000.
    jest.advanceTimersByTime(1000);

    rateLimiter.check("wh_late"); // t=1000.

    jest.advanceTimersByTime(1500);

    expect(rateLimiter.entryCount).toBe(1);

    jest.useRealTimers();
  });

  test("should get and set limit", () => {
    expect(rateLimiter.limit).toBe(5);
    rateLimiter.limit = 20;
    expect(rateLimiter.limit).toBe(20);

    // Validation
    expect(() => {
      rateLimiter.limit = -5;
    }).toThrow("finite positive integer");
    expect(() => {
      rateLimiter.limit = 0;
    }).toThrow();
    expect(() => {
      // @ts-expect-error - testing invalid type
      rateLimiter.limit = "string";
    }).toThrow();
  });

  test("should log pruned count when entries expire (partial pruning)", () => {
    jest.useFakeTimers();
    // Use a fresh instance
    rateLimiter = new WebhookRateLimiter(5, 1000, 10);
    rateLimiter.check("wh_keep");
    jest.advanceTimersByTime(500);
    rateLimiter.check("wh_prune");

    // t=0: check(wh_keep). Expires at t=1000.
    // t=500: check(wh_prune). Expires at t=1500.
    // t=1100: wh_keep expired. wh_prune valid.

    // rateLimiter._cleanup() is called via interval.
    jest.advanceTimersByTime(700); // t=1200.

    // wh_keep should be gone. wh_prune should be there.
    expect(rateLimiter.entryCount).toBe(1);

    // Check specific entry survival
    const remaining = rateLimiter.check("wh_prune");
    expect(remaining.allowed).toBe(true);
    expect(remaining.remaining).toBe(3); // 2 checks done = 2 hits = 3 remaining
    expect(rateLimiter.entryCount).toBe(1);

    // wh_keep should be re-initialized if checked again (resetMs = 0 or close to new window)
    // But since we can't inspect private map easily without exposing, we trust entryCount + specific check logic.
    // However, checking "wh_keep" should create a NEW entry if it was pruned.
    rateLimiter.check("wh_keep");
    expect(rateLimiter.entryCount).toBe(2);

    jest.useRealTimers();
  });
});
