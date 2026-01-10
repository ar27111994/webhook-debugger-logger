import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { RateLimiter } from "../src/utils/rate_limiter.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "./helpers/test-utils.js";

/** @typedef {import("net").Socket} Socket */

describe("RateLimiter Unit Tests", () => {
  /** @type {RateLimiter | null} */
  let rateLimiter = null;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (rateLimiter) rateLimiter.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("should enforce limit within windowMs", () => {
    rateLimiter = new RateLimiter(2, 1000); // 2 requests per 1s
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "1.2.3.4", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
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
    rateLimiter = new RateLimiter(10, 60000, 2);
    const mw = rateLimiter.middleware();
    const next = createMockNextFunction();
    const res = createMockResponse();

    mw(createMockRequest({ ip: "user1", headers: {} }), res, next);
    mw(createMockRequest({ ip: "user2", headers: {} }), res, next);
    expect(rateLimiter.hits.size).toBe(2);

    mw(createMockRequest({ ip: "user3", headers: {} }), res, next);
    expect(rateLimiter.hits.size).toBe(2);
    expect(rateLimiter.hits.has("user1")).toBe(false);
    expect(rateLimiter.hits.has("user3")).toBe(true);
  });

  test("should maintain LRU order: recently accessed entries are moved to end of eviction queue", () => {
    // limit=10, window=1m, maxEntries=2
    rateLimiter = new RateLimiter(10, 60000, 2);
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

    expect(rateLimiter.hits.has("user1")).toBe(true);
    expect(rateLimiter.hits.has("user2")).toBe(false);
    expect(rateLimiter.hits.has("user3")).toBe(true);
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
    expect(rateLimiter.hits.size).toBe(1);

    // Advancing past the 60s hardcoded interval
    jest.advanceTimersByTime(60001);

    expect(rateLimiter.hits.size).toBe(0);
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

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Bad Request",
        message: expect.stringContaining("Client IP could not be identified"),
      }),
    );
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("should identify IP from Express req.ip (default behavior)", () => {
    rateLimiter = new RateLimiter(1, 1000);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "9.9.9.9", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hits.has("9.9.9.9")).toBe(true);
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
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hits.has("10.0.0.1")).toBe(true);
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
    expect(rateLimiter.hits.has("172.16.0.1")).toBe(true);
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
    expect(res.status).toHaveBeenCalledWith(429);

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
    expect(res.status).toHaveBeenCalledWith(429);
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
    rateLimiter = new RateLimiter(1, 600000);
    const mw = rateLimiter.middleware();
    const req = createMockRequest({ ip: "userL", headers: {} });
    const res = createMockResponse();
    const next = createMockNextFunction();

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(590000); // Almost there
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);

    jest.advanceTimersByTime(10001); // Expired
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
    // Should use req.ip, NOT x-forwarded-for
    expect(rateLimiter.hits.has("1.2.3.4")).toBe(true);
    expect(rateLimiter.hits.has("9.9.9.9")).toBe(false);

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
    expect(rateLimiter.hits.has("9.9.9.9")).toBe(true);
    expect(rateLimiter.hits.has("1.2.3.4")).toBe(false);

    // 3. Enabled: trustProxy = true with multiple IPs
    const trustedRL = new RateLimiter(10, 1000, 100, true);
    const trustedMW = trustedRL.middleware();
    trustedMW(req, res, next);
    // Should still use the proxy header (already tested above, but keeping structure)
    expect(trustedRL.hits.has("9.9.9.9")).toBe(true);
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
    expect(rateLimiter.hits.has("1.2.3.4")).toBe(true);
    expect(rateLimiter.hits.has("malformed-ip")).toBe(false);
  });

  test("should throw on invalid constructor arguments", () => {
    expect(() => new RateLimiter(-1, 1000)).toThrow(
      "RateLimiter: limit must be a finite integer >= 0",
    );
    expect(() => new RateLimiter(/** @type {any} */ ("10"), 1000)).toThrow(
      "RateLimiter: limit must be a finite integer >= 0",
    );
    expect(() => new RateLimiter(10, 0)).toThrow(
      "RateLimiter: windowMs must be a finite number > 0",
    );
    expect(() => new RateLimiter(10, -500)).toThrow(
      "RateLimiter: windowMs must be a finite number > 0",
    );
    expect(() => new RateLimiter(10, Infinity)).toThrow(
      "RateLimiter: windowMs must be a finite number > 0",
    );
    expect(() => new RateLimiter(10, 1000, 0)).toThrow(
      "RateLimiter: maxEntries must be a finite integer > 0",
    );
    expect(() => new RateLimiter(10, 1000, -5)).toThrow(
      "RateLimiter: maxEntries must be a finite integer > 0",
    );
    expect(() => new RateLimiter(10, 1000, /** @type {any} */ ("100"))).toThrow(
      "RateLimiter: maxEntries must be a finite integer > 0",
    );
  });

  test("should verify destroy() clears the pruning interval", () => {
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    rateLimiter = new RateLimiter(10, 1000);
    const intervalId = rateLimiter.cleanupInterval;

    rateLimiter.destroy();
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);

    rateLimiter = null; // Prevent afterEach from destroying it again
    clearIntervalSpy.mockRestore();
  });

  test("should log eviction when not in test environment", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      rateLimiter = new RateLimiter(10, 60000, 1);
      const mw = rateLimiter.middleware();
      const next = createMockNextFunction();
      const res = createMockResponse();

      // Fill
      mw(createMockRequest({ ip: "user1", headers: {} }), res, next);

      // Trigger eviction
      mw(createMockRequest({ ip: "user2", headers: {} }), res, next);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SYSTEM] RateLimiter evicted entry"),
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      consoleSpy.mockRestore();
    }
  });
});
