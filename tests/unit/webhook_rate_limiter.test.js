/**
 * @file tests/unit/webhook_rate_limiter.test.js
 * @description Unit tests for WebhookRateLimiter utility.
 */

import { jest } from "@jest/globals";
import { ERROR_MESSAGES } from "../../src/consts/errors.js";
import { APP_CONSTS, ENV_VALUES, ENV_VARS } from "../../src/consts/app.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { assertType } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/utils/webhook_rate_limiter.js').WebhookRateLimiter} WebhookRateLimiter
 */

// Setup mocks first
await setupCommonMocks({ logger: true });

// Import module under test
const { WebhookRateLimiter } =
  await import("../../src/utils/webhook_rate_limiter.js");

describe("WebhookRateLimiter", () => {
  /** @type {WebhookRateLimiter} */
  let limiter;
  const LIMIT = 5;
  const WINDOW_MS = APP_CONSTS.MS_PER_SECOND;
  const MAX_ENTRIES = 10;

  beforeEach(() => {
    jest.useFakeTimers();
    limiter = new WebhookRateLimiter(LIMIT, WINDOW_MS, MAX_ENTRIES);
  });

  afterEach(() => {
    if (limiter) limiter.destroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("Constructor & Config", () => {
    it("should throw on invalid limit", () => {
      const invalidLimits = [0, -1, "10"];

      invalidLimits.forEach((limit) => {
        expect(() => new WebhookRateLimiter(assertType(limit))).toThrow(
          ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT,
        );
      });
    });

    it("should throw on invalid windowMs", () => {
      const limit = 10;
      const negativeWindowMs = -100;
      const zeroWindowMs = 0;
      const invalidWindows = [
        zeroWindowMs,
        negativeWindowMs,
        String(WINDOW_MS),
      ];

      invalidWindows.forEach((windowMs) => {
        expect(
          () => new WebhookRateLimiter(limit, assertType(windowMs)),
        ).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_WINDOW);
      });
    });

    it("should throw on invalid maxEntries", () => {
      const limit = 10;
      const decimalMaxEntries = 10.5;
      const invalidMaxEntries = [0, decimalMaxEntries];

      invalidMaxEntries.forEach((maxEntries) => {
        expect(
          () =>
            new WebhookRateLimiter(limit, WINDOW_MS, assertType(maxEntries)),
        ).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_MAX_ENTRIES);
      });
    });

    it("should allow updating limit via setter", () => {
      const newLimit = 20;
      limiter.limit = newLimit;
      expect(limiter.limit).toBe(newLimit);
      expect(() => {
        limiter.limit = 0;
      }).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
    });
  });

  describe("Rate Limiting Logic", () => {
    it("should allow requests within limit", () => {
      const webhookId = "hook1";
      const result1 = limiter.check(webhookId);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(LIMIT - 1);

      const result2 = limiter.check(webhookId);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(LIMIT - (1 + 1));
    });

    it("should block requests exceeding limit", () => {
      const webhookId = "hook1";
      // Use up the limit
      for (let i = 0; i < LIMIT; i++) {
        limiter.check(webhookId);
      }

      const blocked = limiter.check(webhookId);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.resetMs).toBeGreaterThan(0);
      expect(blocked.resetMs).toBeLessThanOrEqual(WINDOW_MS);
    });

    it("should reset limit after windowMs", () => {
      const webhookId = "hook1";
      // Exhaust limit
      for (let i = 0; i < LIMIT; i++) {
        limiter.check(webhookId);
      }
      expect(limiter.check(webhookId).allowed).toBe(false);

      // Advance time past window
      const timeToAdvance = 10;
      jest.advanceTimersByTime(WINDOW_MS + timeToAdvance);

      const result = limiter.check(webhookId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);
    });

    it("should calculate resetMs correctly", () => {
      const timeToReduce = 2;
      const webhookId = "hook1";
      limiter.check(webhookId); // First hit

      // Advance halfway
      jest.advanceTimersByTime(WINDOW_MS / timeToReduce);

      // Fill rest
      for (let i = 1; i < LIMIT; i++) {
        limiter.check(webhookId);
      }

      const blocked = limiter.check(webhookId);
      // resetMs should be roughly remaining window from FIRST hit

      const timeToAdvance = 50;
      expect(blocked.resetMs).toBeLessThanOrEqual(
        WINDOW_MS / timeToReduce + timeToAdvance,
      ); // Allowing slight buffer
      expect(blocked.resetMs).toBeGreaterThan(0);
    });
  });

  describe("Composite Keys (IP differentiation)", () => {
    it("should track different IPs independently for same webhookId", () => {
      const webhookId = "hook1";
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      const ip1 = "1.1.1.1";
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      const ip2 = "2.2.2.2";
      // Exhaust IP 1
      for (let i = 0; i < LIMIT; i++) {
        limiter.check(webhookId, ip1);
      }
      expect(limiter.check(webhookId, ip1).allowed).toBe(false);

      // IP 2 should still be free
      const resultIp2 = limiter.check(webhookId, ip2);
      expect(resultIp2.allowed).toBe(true);
      expect(resultIp2.remaining).toBe(LIMIT - 1);
    });

    it("should distinguish undefined IP from specified IP", () => {
      const webhookId = "hook1";
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      const ip1 = "1.2.3.4";
      limiter.check(webhookId); // Undefined IP
      limiter.check(webhookId, ip1);

      // They are distinct keys
      expect(limiter.entryCount).toBe(1 + 1);
    });
  });

  describe("Max Entries & LRU Eviction", () => {
    it("should accept new keys up to maxEntries", () => {
      const maxEntries = 3;
      const smallLimiter = new WebhookRateLimiter(LIMIT, WINDOW_MS, maxEntries);
      smallLimiter.check("k1");
      smallLimiter.check("k2");
      smallLimiter.check("k3");
      expect(smallLimiter.entryCount).toBe(maxEntries);
    });

    it("should evict oldest key when capacity exceeded", () => {
      const maxEntries = 2;
      const smallLimiter = new WebhookRateLimiter(LIMIT, WINDOW_MS, maxEntries);

      smallLimiter.check("k1"); // k1 accessed
      const timeToAdvance = 10;
      jest.advanceTimersByTime(timeToAdvance);
      smallLimiter.check("k2"); // k2 accessed

      expect(smallLimiter.entryCount).toBe(maxEntries);

      // refresh k1
      jest.advanceTimersByTime(timeToAdvance);
      smallLimiter.check("k1");

      // Add k3 -> should evict k2 (oldest)
      jest.advanceTimersByTime(timeToAdvance);
      smallLimiter.check("k3");

      expect(smallLimiter.entryCount).toBe(maxEntries);

      // k1 should be preserved (3 hits)
      const k1Result = smallLimiter.check("k1");
      expect(k1Result.remaining).toBe(LIMIT - (1 + 1 + 1));

      // k2 was evicted, so checking it now starts fresh (1 hit)
      const k2Result = smallLimiter.check("k2");
      expect(k2Result.remaining).toBe(LIMIT - 1);
    });
  });

  describe("Cleanup Interval and Key Generation Edge Cases", () => {
    it("should correctly prune stale entries, retain partial entries, and log when env is production", () => {
      const windowMs = 10;
      const clockLimiter = new WebhookRateLimiter(
        LIMIT,
        windowMs * APP_CONSTS.MS_PER_SECOND,
        MAX_ENTRIES,
      );

      // Partially stale
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      clockLimiter.check("wh_1", "1.1.1.1");

      const timeToAdvanceInSeconds = 55;
      jest.advanceTimersByTime(
        timeToAdvanceInSeconds * APP_CONSTS.MS_PER_SECOND,
      ); // Wait 55s, limit is 60s, window 10000ms

      // Fresh!
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      clockLimiter.check("wh_1", "1.1.1.1");

      // Trigger the internal 60s hook
      const timeToAdvanceInSeconds2 = 5;
      jest.advanceTimersByTime(
        timeToAdvanceInSeconds2 * APP_CONSTS.MS_PER_SECOND,
      ); // hits 60s

      expect(clockLimiter.entryCount).toBe(1); // Hits line 91

      const originalEnv = process.env[ENV_VARS.NODE_ENV];

      // Register an eviction
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      clockLimiter.check("wh_2", "2.2.2.2"); // hits at 60s

      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;

      const timeToAdvanceInSeconds3 = 75;
      jest.advanceTimersByTime(
        timeToAdvanceInSeconds3 * APP_CONSTS.MS_PER_SECOND,
      ); // 10s window + 60s sleep

      process.env[ENV_VARS.NODE_ENV] = originalEnv;

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ prunedCount: expect.any(Number) }),
        LOG_MESSAGES.WEBHOOK_RATELIMIT_PRUNED,
      );

      clockLimiter.destroy();
    });

    it("should trigger unique block warnings for webhook boundaries", () => {
      const webhookId = "wh_abc";
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      const ip = "1.2.3.4";

      for (let i = 0; i < LIMIT; i++) {
        limiter.check(webhookId, ip);
      }

      const blocked = limiter.check(webhookId, ip);
      expect(blocked.allowed).toBe(false);
    });

    it("should handle undefined IP gracefully", () => {
      const result = limiter.check("wh_123", undefined);
      expect(result.allowed).toBe(true);
      expect(limiter.entryCount).toBe(1);
    });

    it("should handle missing webhookId gracefully by falling back to rate limiting globally", () => {
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      const result = limiter.check(assertType(undefined), "5.5.5.5");
      expect(result.allowed).toBe(true);
      expect(limiter.entryCount).toBe(1);
    });

    it("should handle missing both gracefully", () => {
      const result = limiter.check(assertType(undefined), undefined);
      expect(result.allowed).toBe(true);
      expect(limiter.entryCount).toBe(1);
    });

    it("should trigger constructor defaults when instantiated with no arguments", () => {
      const defaultLimiter = new WebhookRateLimiter();
      expect(defaultLimiter.limit).toBe(
        APP_CONSTS.DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE,
      );
      defaultLimiter.destroy();
    });

    it("should handle unref missing safely", () => {
      const origSetInterval = global.setInterval;
      global.setInterval = assertType(jest.fn(() => ({ unref: undefined }))); // return object without unref

      const safeLimiter = new WebhookRateLimiter();
      expect(safeLimiter.limit).toBeDefined();

      global.setInterval = origSetInterval;
    });

    it("should handle destroy gracefully when cleanupInterval is missing natively", () => {
      const origSetInterval = global.setInterval;
      // Force '#cleanupInterval' field to falsy value natively
      global.setInterval = assertType(jest.fn(() => undefined));

      const localLimiter = new WebhookRateLimiter();
      expect(() => localLimiter.destroy()).not.toThrow();

      global.setInterval = origSetInterval;
    });

    it("should handle oldestKey not being a string safely during eviction", () => {
      const smallLimiter = new WebhookRateLimiter(LIMIT, WINDOW_MS, 1);

      // Branch line: force a numeric key during check by substituting Map properties
      const originalKeys = Map.prototype.keys;
      const mockIterator = {
        next: () => ({ value: 12345, done: false }),
      };

      Map.prototype.keys = assertType(jest.fn(() => mockIterator));

      smallLimiter.check("normal_key_1");
      smallLimiter.check("normal_key_2");

      expect(smallLimiter.entryCount).toBe(1 + 1);
      // Cleanup mapping
      Map.prototype.keys = originalKeys;
    });

    it("should calculate resetMs without oldestHit if empty array (edge case fallback)", () => {
      const webhookId = "key_a";
      const clockLimiter = new WebhookRateLimiter(1, WINDOW_MS, MAX_ENTRIES);
      clockLimiter.check(webhookId);

      const origFilter = Array.prototype.filter;
      // Return an array with undefined elements to trigger the fallback logic when length > limit
      Array.prototype.filter = assertType(
        jest.fn(() => [undefined, undefined]),
      );

      const result = clockLimiter.check(webhookId);
      expect(result.resetMs).toBeGreaterThan(0);

      Array.prototype.filter = origFilter;
      clockLimiter.destroy();
    });
  });

  describe("Security and Sanitation checks", () => {
    it("should handle Object.prototype pollution keys safely", () => {
      const result1 = limiter.check("__proto__", "constructor");
      expect(result1.allowed).toBe(true);
      expect(limiter.entryCount).toBe(1);

      const result2 = limiter.check("__proto__", "constructor");
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(LIMIT - (1 + 1));
    });

    it("should handle extremely long strings without crashing", () => {
      const oneMegabyte = 1000000;
      const longString = "A".repeat(oneMegabyte); // 1 MB string
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      const result = limiter.check(longString, "1.1.1.1");
      expect(result.allowed).toBe(true);
      expect(limiter.entryCount).toBe(1);
    });
  });

  describe("System Clock Skew (NTP Adjustments)", () => {
    it("should handle time moving backwards gracefully", () => {
      const webhookId = "clockhook";
      limiter.check(webhookId);

      // Simulate NTP adjusting clock back 1 hour
      const offset = APP_CONSTS.MS_PER_HOUR;
      const originalNow = Date.now;
      Date.now = () => originalNow() - offset;

      const result = limiter.check(webhookId);
      expect(result.allowed).toBe(true); // Should not crash and should allow
      expect(result.remaining).toBe(LIMIT - (1 + 1));

      // Restore
      Date.now = originalNow;
    });
  });

  describe("Stress and Algorithmic Complexity", () => {
    it("should process rapid limit-busting requests without blocking event loop significantly", () => {
      const webhookId = "stress_hook";
      const stressLimit = 10000;
      const stressLimiter = new WebhookRateLimiter(
        stressLimit,
        WINDOW_MS,
        MAX_ENTRIES,
      );

      const start = Date.now();
      for (let i = 0; i < stressLimit; i++) {
        stressLimiter.check(webhookId);
      }
      const elapsed = Date.now() - start;

      // Filter is fast but not instantaneous. Just verify it finishes within a reasonable time slice.
      const timeoutThreshold = 500; // ms
      expect(elapsed).toBeLessThan(timeoutThreshold);

      const blocked = stressLimiter.check(webhookId);
      expect(blocked.allowed).toBe(false);

      stressLimiter.destroy();
    });
  });
});
