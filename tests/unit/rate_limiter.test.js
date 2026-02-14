import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  useFakeTimers,
  useMockCleanup,
} from "../setup/helpers/test-lifecycle.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { loggerMock, constsMock } from "../setup/helpers/shared-mocks.js";

// Mock logger before importing RateLimiter
await setupCommonMocks({ logger: true, consts: true });

import { LOG_MESSAGES } from "../../src/consts/messages.js";

const { RateLimiter } = await import("../../src/utils/rate_limiter.js");

/**
 * @typedef {import("net").Socket} Socket
 * @typedef {import("../../src/utils/rate_limiter.js").RateLimiter} RateLimiterType
 */

describe("RateLimiter Unit Tests", () => {
  /** @type {RateLimiterType} */
  let rateLimiter;

  useFakeTimers();

  beforeEach(() => {
    rateLimiter = new RateLimiter(2, constsMock.DEFAULT_RATE_LIMIT_WINDOW_MS);
  });

  useMockCleanup();

  afterEach(() => {
    if (rateLimiter) rateLimiter.destroy();

    jest.restoreAllMocks();
  });

  test("should enforce limit within windowMs", () => {
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "1.2.3.4", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(
      constsMock.HTTP_STATUS.TOO_MANY_REQUESTS,
    );
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should reset hits after windowMs", () => {
    rateLimiter = new RateLimiter(1, 1000);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "1.1.1.1", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1100);

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should evict oldest entry when maxEntries is reached", () => {
    // limit=10, window=1m, maxEntries=2
    rateLimiter = new RateLimiter(
      10,
      constsMock.DEFAULT_RATE_LIMIT_WINDOW_MS,
      2,
    );
    const mw = rateLimiter.middleware();
    const next = createMockNextFunction();
    const res = createMockResponse();

    mw(createMockRequest({ ip: "user1", headers: {} }), res, next);
    mw(createMockRequest({ ip: "user2", headers: {} }), res, next);
    mw(createMockRequest({ ip: "user1", headers: {} }), res, next);
    mw(createMockRequest({ ip: "user2", headers: {} }), res, next);
    expect(rateLimiter.entryCount).toBe(2);

    mw(createMockRequest({ ip: "user3", headers: {} }), res, next);
    mw(createMockRequest({ ip: "user3", headers: {} }), res, next);
    expect(rateLimiter.entryCount).toBe(2);
    expect(rateLimiter.hasIp("user1")).toBe(false);
    expect(rateLimiter.hasIp("user3")).toBe(true);
  });

  test("should maintain LRU order: recently accessed entries are moved to end of eviction queue", () => {
    // limit=10, window=1m, maxEntries=2
    rateLimiter = new RateLimiter(
      10,
      constsMock.DEFAULT_RATE_LIMIT_WINDOW_MS,
      2,
    );
    const mw = rateLimiter.middleware();
    const next = createMockNextFunction();
    const res = createMockResponse();

    // 1. Insert user1, then user2
    mw(createMockRequest({ ip: "user1", headers: {} }), res, next);
    mw(createMockRequest({ ip: "user2", headers: {} }), res, next);

    // 2. Access user1 again (should move to end of Map, making user2 the oldest)
    mw(createMockRequest({ ip: "user1", headers: {} }), res, next);

    // 3. Insert user3 (should trigger eviction of user2, NOT user1)
    mw(createMockRequest({ ip: "user3", headers: {} }), res, next);

    expect(rateLimiter.hasIp("user1")).toBe(true);
    expect(rateLimiter.hasIp("user2")).toBe(false);
    expect(rateLimiter.hasIp("user3")).toBe(true);
  });

  /**
   * NOTE: The RateLimiter uses a hardcoded 60000ms pruning interval.
   * Advancing timers past 60000ms triggers the background cleanup of expired entries.
   */
  test("should prune expired entries in background", () => {
    rateLimiter = new RateLimiter(10, 1000, 100);
    const mw = rateLimiter.middleware();
    const next = createMockNextFunction();
    const res = createMockResponse();

    mw(createMockRequest({ ip: "userA", headers: {} }), res, next);
    mw(createMockRequest({ ip: "userA", headers: {} }), res, next);
    expect(rateLimiter.entryCount).toBe(1);

    // Advancing past the 60s hardcoded interval
    jest.advanceTimersByTime(constsMock.DEFAULT_RATE_LIMIT_WINDOW_MS + 1); // 60s + 1ms

    expect(rateLimiter.entryCount).toBe(0);
  });

  test("should log pruning when not in test environment", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      rateLimiter = new RateLimiter(10, 1000, 100);
      const mw = rateLimiter.middleware();
      const next = createMockNextFunction();
      const res = createMockResponse();

      mw(createMockRequest({ ip: "userA", headers: {} }), res, next);

      // Advance past window so it's PRUNABLE
      jest.advanceTimersByTime(1100);
      // Background interval check
      jest.advanceTimersByTime(constsMock.DEFAULT_RATE_LIMIT_WINDOW_MS);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ prunedCount: 1 }),
        LOG_MESSAGES.RATELIMIT_PRUNED,
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("should return false for hasIp in non-test environment", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      rateLimiter = new RateLimiter(10, 1000, 100);
      const mw = rateLimiter.middleware();
      mw(
        createMockRequest({ ip: "1.2.3.4", headers: {} }),
        createMockResponse(),
        createMockNextFunction(),
      );

      expect(rateLimiter.hasIp("1.2.3.4")).toBe(false);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("should reject requests without identifiable IP", () => {
    rateLimiter = new RateLimiter(10, 1000);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({
      socket: /** @type {Socket} */ ({}),
      headers: { "user-agent": "test-bot" },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Bad Request",
        message: expect.stringContaining("Client IP could not be identified"),
      }),
    );
    // Source uses structured pino logging via log.warn
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: "test-bot" }),
      "Rejecting request with unidentifiable IP",
    );
  });

  test("should identify IP from Express req.ip (default behavior)", () => {
    rateLimiter = new RateLimiter(1, 1000);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "9.9.9.9", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hasIp("9.9.9.9")).toBe(true);
  });

  test("should use x-forwarded-for when trustProxy is enabled and req.ip is absent", () => {
    rateLimiter = new RateLimiter(1, 1000, 100, true);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({
      headers: { "x-forwarded-for": "10.0.0.1, 192.168.1.1" },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(rateLimiter.hasIp("10.0.0.1")).toBe(true);
  });

  test("should handle x-forwarded-for with multiple IPs and extract the first one", () => {
    rateLimiter = new RateLimiter(1, 1000, 100, true);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hasIp("1.1.1.1")).toBe(true);
    expect(rateLimiter.hasIp("2.2.2.2")).toBe(false);
  });

  test("should use x-real-ip when trustProxy is enabled and req.ip is absent", () => {
    rateLimiter = new RateLimiter(1, 1000, 100, true);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({
      headers: { "x-real-ip": "172.16.0.1" },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hasIp("172.16.0.1")).toBe(true);
  });

  test("should ensure isolation between distinct IPs", () => {
    rateLimiter = new RateLimiter(1, 1000);
    const mw = rateLimiter.middleware();
    const next = createMockNextFunction();
    const res = createMockResponse();

    // User A hits limit
    mw(createMockRequest({ ip: "userA", headers: {} }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    mw(createMockRequest({ ip: "userA", headers: {} }), res, next);
    expect(res.status).toHaveBeenCalledWith(
      constsMock.HTTP_STATUS.TOO_MANY_REQUESTS,
    );

    // User B should still be allowed (independent counter)
    mw(createMockRequest({ ip: "userB", headers: {} }), res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should handle limit=0 (immediate blockage)", () => {
    rateLimiter = new RateLimiter(0, 1000);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "1.2.3.4", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(
      constsMock.HTTP_STATUS.TOO_MANY_REQUESTS,
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("should handle very short windowMs", () => {
    // Short: 10ms
    rateLimiter = new RateLimiter(1, 10);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "userS", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(11);
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should handle long windowMs", () => {
    // Long: 10 minutes
    const windowMs = constsMock.DEFAULT_RATE_LIMIT_WINDOW_MS * 10;
    rateLimiter = new RateLimiter(1, windowMs);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "userL", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Almost there
    const almostThere = 10000;
    jest.advanceTimersByTime(windowMs - almostThere);
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(
      constsMock.HTTP_STATUS.TOO_MANY_REQUESTS,
    );

    jest.advanceTimersByTime(almostThere + 1); // Expired
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should verify IP masking for PII protection", () => {
    rateLimiter = new RateLimiter(10, 1000);
    expect(rateLimiter.maskIp("192.168.1.100")).toBe("192.168.1.****");
    expect(rateLimiter.maskIp("2001:0db8:85a3:0000")).toBe("2001:0db8:****");
    expect(rateLimiter.maskIp(null)).toBe("unknown");
  });

  test("should validate IPv4 and IPv6 formats correctly", () => {
    rateLimiter = new RateLimiter(10, 1000);
    expect(rateLimiter.isValidIp("1.2.3.4")).toBe(true);
    expect(rateLimiter.isValidIp("255.255.255.255")).toBe(true);
    expect(
      rateLimiter.isValidIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
    ).toBe(true);
    expect(rateLimiter.isValidIp("::1")).toBe(true);

    expect(rateLimiter.isValidIp("999.999.999.999")).toBe(false);
    expect(rateLimiter.isValidIp("not-an-ip")).toBe(false);
    expect(rateLimiter.isValidIp("1.2.3")).toBe(false);
    expect(rateLimiter.isValidIp(12345)).toBe(false);
  });

  test("should only trust proxy headers when trustProxy is enabled", () => {
    // 1. Default: trustProxy = false
    rateLimiter = new RateLimiter(10, 1000, 100, false);
    let mw = rateLimiter.middleware();
    let req = createMockRequest({
      ip: "1.2.3.4",
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    mw(req, res, next);
    // Should use req.ip, NOT x-forwarded-for
    expect(rateLimiter.hasIp("1.2.3.4")).toBe(true);
    expect(rateLimiter.hasIp("9.9.9.9")).toBe(false);

    // 2. Enabled: trustProxy = true
    rateLimiter.destroy();
    rateLimiter = new RateLimiter(10, 1000, 100, true);
    mw = rateLimiter.middleware(); // Must update middleware reference!
    req = createMockRequest({
      ip: "1.2.3.4",
      headers: { "x-forwarded-for": "9.9.9.9" },
    });

    mw(req, res, next);
    // Should use x-forwarded-for, NOT req.ip
    expect(rateLimiter.hasIp("9.9.9.9")).toBe(true);
    expect(rateLimiter.hasIp("1.2.3.4")).toBe(false);

    // 3. Enabled: trustProxy = true with multiple IPs
    const trustedRL = new RateLimiter(10, 1000, 100, true);
    const trustedMW = trustedRL.middleware();
    trustedMW(req, res, next);
    // Should still use the proxy header (already tested above, but keeping structure)
    expect(trustedRL.hasIp("9.9.9.9")).toBe(true);
    trustedRL.destroy();
  });

  test("should ignore malformed proxy headers even when trustProxy is enabled", () => {
    rateLimiter = new RateLimiter(10, 1000, 100, true);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({
      ip: "1.2.3.4",
      headers: {
        "x-forwarded-for": "malformed-ip, 8.8.8.8",
        "x-real-ip": "invalid",
      },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    // Should fall back to req.ip because both headers are malformed/invalid
    expect(rateLimiter.hasIp("1.2.3.4")).toBe(true);
    expect(rateLimiter.hasIp("malformed-ip")).toBe(false);
  });

  test("should throw on invalid constructor arguments", () => {
    expect(() => new RateLimiter(-1, 1000)).toThrow(
      "RateLimiter: limit must be a finite integer >= 0",
    );
    expect(() => new RateLimiter(assertType("10"), 1000)).toThrow(
      "RateLimiter: limit must be a finite integer >= 0",
    );
    expect(() => new RateLimiter(10, 0)).toThrow(
      "RateLimiter: windowMs must be a finite number > 0",
    );
    expect(
      () => new RateLimiter(10, -constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR),
    ).toThrow("RateLimiter: windowMs must be a finite number > 0");
    expect(() => new RateLimiter(10, Infinity)).toThrow(
      "RateLimiter: windowMs must be a finite number > 0",
    );
    expect(() => new RateLimiter(10, 1000, 0)).toThrow(
      "RateLimiter: maxEntries must be a finite integer > 0",
    );
    expect(() => new RateLimiter(10, 1000, -5)).toThrow(
      "RateLimiter: maxEntries must be a finite integer > 0",
    );
    expect(() => new RateLimiter(10, 1000, assertType("100"))).toThrow(
      "RateLimiter: maxEntries must be a finite integer > 0",
    );
  });

  test("should verify destroy() clears the pruning interval", () => {
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    rateLimiter = new RateLimiter(10, 1000);

    rateLimiter.destroy();
    expect(clearIntervalSpy).toHaveBeenCalled(); // Cannot verify ID as it is private

    rateLimiter = assertType(null); // Prevent afterEach from destroying it again
    clearIntervalSpy.mockRestore();
  });

  test("should log eviction when not in test environment", () => {
    const originalEnv = process.env.NODE_ENV;

    // We must rebuild the rate limiter instance while NODE_ENV is production
    // because logger initialization might depend on it.
    process.env.NODE_ENV = "production";

    try {
      rateLimiter = new RateLimiter(
        10,
        constsMock.DEFAULT_RATE_LIMIT_WINDOW_MS,
        1,
      );
      const mw = rateLimiter.middleware();
      const next = createMockNextFunction();
      const res = createMockResponse();

      // Fill
      mw(createMockRequest({ ip: "user1", headers: {} }), res, next);

      // Trigger eviction
      mw(createMockRequest({ ip: "user2", headers: {} }), res, next);

      // Source uses structured pino logging via log.info
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ evictedIp: expect.any(String) }),
        LOG_MESSAGES.RATELIMIT_EVICTED,
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("should extract first valid IP from array header value", () => {
    // Tests the utility method extractFirstValidIp directly
    rateLimiter = new RateLimiter(10, 1000);
    const arrayHeader = ["10.0.0.1", "192.168.1.1"];

    const result = rateLimiter.extractFirstValidIp(arrayHeader);
    expect(result).toBe("10.0.0.1");

    // Also test single value behavior
    expect(rateLimiter.extractFirstValidIp("1.1.1.1")).toBe("1.1.1.1");
    // Test empty
    expect(rateLimiter.extractFirstValidIp([])).toBeUndefined();
    expect(rateLimiter.extractFirstValidIp(undefined)).toBeUndefined();
  });
});
