import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { RateLimiter } from "../src/utils/rate_limiter.js";

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
    const req = /** @type {any} */ ({ ip: "1.2.3.4", headers: {} });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalledTimes(2);

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should reset hits after windowMs", () => {
    rateLimiter = new RateLimiter(1, 1000);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({ ip: "1.1.1.1", headers: {} });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1100);

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should evict oldest entry when maxEntries is reached", () => {
    // limit=10, window=1m, maxEntries=2
    rateLimiter = new RateLimiter(10, 60000, 2);
    const mw = rateLimiter.middleware();
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    mw(
      /** @type {any} */ ({ ip: "user1", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    mw(
      /** @type {any} */ ({ ip: "user2", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    expect(rateLimiter.hits.size).toBe(2);

    mw(
      /** @type {any} */ ({ ip: "user3", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    expect(rateLimiter.hits.size).toBe(2);
    expect(rateLimiter.hits.has("user1")).toBe(false);
    expect(rateLimiter.hits.has("user3")).toBe(true);
  });

  test("should maintain LRU order: recently accessed entries are moved to end of eviction queue", () => {
    // limit=10, window=1m, maxEntries=2
    rateLimiter = new RateLimiter(10, 60000, 2);
    const mw = rateLimiter.middleware();
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    // 1. Insert user1, then user2
    mw(
      /** @type {any} */ ({ ip: "user1", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    mw(
      /** @type {any} */ ({ ip: "user2", headers: {} }),
      /** @type {any} */ (res),
      next,
    );

    // 2. Access user1 again (should move to end of Map, making user2 the oldest)
    mw(
      /** @type {any} */ ({ ip: "user1", headers: {} }),
      /** @type {any} */ (res),
      next,
    );

    // 3. Insert user3 (should trigger eviction of user2, NOT user1)
    mw(
      /** @type {any} */ ({ ip: "user3", headers: {} }),
      /** @type {any} */ (res),
      next,
    );

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
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    mw(
      /** @type {any} */ ({ ip: "userA", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    expect(rateLimiter.hits.size).toBe(1);

    // Advancing past the 60s hardcoded interval
    jest.advanceTimersByTime(60001);

    expect(rateLimiter.hits.size).toBe(0);
  });

  test("should reject requests without identifiable IP", () => {
    rateLimiter = new RateLimiter(10, 1000);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({
      socket: {},
      headers: { "user-agent": "test-bot" },
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);

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
    const req = /** @type {any} */ ({ ip: "9.9.9.9", headers: {} });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hits.has("9.9.9.9")).toBe(true);
  });

  test("should use x-forwarded-for when trustProxy is enabled and req.ip is absent", () => {
    rateLimiter = new RateLimiter(1, 1000, 100, true);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({
      headers: { "x-forwarded-for": "10.0.0.1, 192.168.1.1" },
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hits.has("10.0.0.1")).toBe(true);
  });

  test("should use x-real-ip when trustProxy is enabled and req.ip is absent", () => {
    rateLimiter = new RateLimiter(1, 1000, 100, true);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({ headers: { "x-real-ip": "172.16.0.1" } });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalled();
    expect(rateLimiter.hits.has("172.16.0.1")).toBe(true);
  });

  test("should ensure isolation between distinct IPs", () => {
    rateLimiter = new RateLimiter(1, 1000);
    const mw = rateLimiter.middleware();
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    // User A hits limit
    mw(
      /** @type {any} */ ({ ip: "userA", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    mw(
      /** @type {any} */ ({ ip: "userA", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    expect(res.status).toHaveBeenCalledWith(429);

    // User B should still be allowed (independent counter)
    mw(
      /** @type {any} */ ({ ip: "userB", headers: {} }),
      /** @type {any} */ (res),
      next,
    );
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should handle limit=0 (immediate blockage)", () => {
    rateLimiter = new RateLimiter(0, 1000);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({ ip: "1.2.3.4", headers: {} });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  test("should handle very short windowMs", () => {
    // Short: 10ms
    rateLimiter = new RateLimiter(1, 10);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({ ip: "userS", headers: {} });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(11);
    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("should handle long windowMs", () => {
    // Long: 10 minutes
    rateLimiter = new RateLimiter(1, 600000);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({ ip: "userL", headers: {} });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(590000); // Almost there
    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(res.status).toHaveBeenCalledWith(429);

    jest.advanceTimersByTime(10001); // Expired
    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
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
    // Default: false
    rateLimiter = new RateLimiter(10, 1000, 100, false);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({
      ip: "1.2.3.4",
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    // Should use req.ip, NOT x-forwarded-for
    expect(rateLimiter.hits.has("1.2.3.4")).toBe(true);
    expect(rateLimiter.hits.has("9.9.9.9")).toBe(false);

    // Enabled: true
    const trustedRL = new RateLimiter(10, 1000, 100, true);
    const trustedMW = trustedRL.middleware();
    trustedMW(/** @type {any} */ (req), /** @type {any} */ (res), next);
    expect(trustedRL.hits.has("9.9.9.9")).toBe(true);
    trustedRL.destroy();
  });

  test("should ignore malformed proxy headers even when trustProxy is enabled", () => {
    rateLimiter = new RateLimiter(10, 1000, 100, true);
    const mw = rateLimiter.middleware();
    const req = /** @type {any} */ ({
      ip: "1.2.3.4",
      headers: {
        "x-forwarded-for": "malformed-ip, 8.8.8.8",
        "x-real-ip": "invalid",
      },
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
    // Should fall back to req.ip because both headers are malformed/invalid
    expect(rateLimiter.hits.has("1.2.3.4")).toBe(true);
    expect(rateLimiter.hits.has("malformed-ip")).toBe(false);
  });

  test("should throw on invalid constructor arguments", () => {
    expect(() => new RateLimiter(-1, 1000)).toThrow(
      "RateLimiter: limit must be a finite integer >= 0",
    );
    // @ts-expect-error - Testing invalid type for limit parameter
    expect(() => new RateLimiter("10", 1000)).toThrow(
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
    // @ts-expect-error - Testing invalid type for maxEntries parameter
    expect(() => new RateLimiter(10, 1000, "100")).toThrow(
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
});
