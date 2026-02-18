import {
  describe,
  test,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { CircuitBreaker } from "../../src/services/CircuitBreaker.js";
import { FORWARDING_CONSTS } from "../../src/consts/app.js";

const TEST_URL = "https://example.com";
const EXPIRED_OFFSET_MS = 1000;
const EXTRA_ENTRIES = 5;
const EVICTION_EXTRA = 3;
const EVICTION_EXTRA_OFFSET = 2;

describe("CircuitBreaker", () => {
  /** @type {CircuitBreaker} */
  let breaker;

  beforeEach(() => {
    jest.useFakeTimers();
    breaker = new CircuitBreaker();
  });

  afterEach(() => {
    breaker.destroy();
    jest.useRealTimers();
  });

  describe("Initial State", () => {
    test("should be closed for any URL initially", () => {
      expect(breaker.isOpen(TEST_URL)).toBe(false);
    });

    test("should initialize with correct thresholds from FORWARDING_CONSTS", () => {
      expect(breaker.failureThreshold).toBe(
        FORWARDING_CONSTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      );
      expect(breaker.resetTimeoutMs).toBe(
        FORWARDING_CONSTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      );
      expect(breaker.maxSize).toBe(FORWARDING_CONSTS.CIRCUIT_BREAKER_MAX_SIZE);
    });

    test("should have empty states map initially", () => {
      expect(breaker.states.size).toBe(0);
    });
  });

  describe("State Transitions", () => {
    test("should remain closed under failure threshold", () => {
      for (let i = 0; i < breaker.failureThreshold - 1; i++) {
        breaker.recordFailure(TEST_URL);
      }
      expect(breaker.isOpen(TEST_URL)).toBe(false);
    });

    test("should open after failure threshold reached", () => {
      const limit = breaker.failureThreshold;
      for (let i = 0; i < limit; i++) {
        breaker.recordFailure(TEST_URL);
      }
      expect(breaker.isOpen(TEST_URL)).toBe(true);
    });

    test("should record failure and init default state if not exists", () => {
      const url = "https://new-host.com";
      breaker.recordFailure(url);
      const state = breaker.states.get("new-host.com");
      expect(state).toBeDefined();
      expect(/** @type {NonNullable<typeof state>} */(state).failures).toBe(1);
    });

    test("should operate at hostname level (different protocols, same host)", () => {
      // CircuitBreaker extracts hostname, so http/https share state
      const httpUrl = "https://example.com/path-a";
      const httpsUrl = "https://example.com/path-b";
      const limit = breaker.failureThreshold;

      for (let i = 0; i < limit; i++) {
        breaker.recordFailure(httpUrl);
      }

      expect(breaker.isOpen(httpsUrl)).toBe(true);
    });

    test("should operate at hostname level (different paths, same host)", () => {
      const urlA = "https://api.example.com/endpoint-a";
      const urlB = "https://api.example.com/endpoint-b";

      for (let i = 0; i < breaker.failureThreshold; i++) {
        breaker.recordFailure(urlA);
      }

      expect(breaker.isOpen(urlB)).toBe(true);
    });

    test("should treat different hosts independently", () => {
      const hostA = "https://a.com";
      const hostB = "https://b.com";

      for (let i = 0; i < breaker.failureThreshold; i++) {
        breaker.recordFailure(hostA);
      }

      expect(breaker.isOpen(hostA)).toBe(true);
      expect(breaker.isOpen(hostB)).toBe(false);
    });
  });

  describe("Recovery Logic", () => {
    test("should return false if state is undefined in isOpen", () => {
      expect(breaker.isOpen("https://unknown.com")).toBe(false);
    });

    test("should remain open until reset timeout passes", () => {
      for (let i = 0; i < breaker.failureThreshold; i++) {
        breaker.recordFailure(TEST_URL);
      }

      jest.advanceTimersByTime(breaker.resetTimeoutMs - 1);
      expect(breaker.isOpen(TEST_URL)).toBe(true);
    });

    test("should transition to half-open (allow retry) after reset timeout", () => {
      for (let i = 0; i < breaker.failureThreshold; i++) {
        breaker.recordFailure(TEST_URL);
      }

      jest.advanceTimersByTime(breaker.resetTimeoutMs + 1);
      expect(breaker.isOpen(TEST_URL)).toBe(false);
    });

    test("should clear state on recordSuccess (even if state exists)", () => {
      const host = new URL(TEST_URL).hostname;
      breaker.recordFailure(TEST_URL);
      expect(breaker.states.has(host)).toBe(true);

      breaker.recordSuccess(TEST_URL);
      expect(breaker.states.has(host)).toBe(false);
    });

    test("should do nothing on recordSuccess if state does not exist", () => {
      expect(breaker.states.has(new URL(TEST_URL).hostname)).toBe(false);
      expect(() => breaker.recordSuccess(TEST_URL)).not.toThrow();
    });

    test("should re-open if failures accumulate again after recovery", () => {
      // First trip
      for (let i = 0; i < breaker.failureThreshold; i++) {
        breaker.recordFailure(TEST_URL);
      }
      expect(breaker.isOpen(TEST_URL)).toBe(true);

      // Recover
      breaker.recordSuccess(TEST_URL);
      expect(breaker.isOpen(TEST_URL)).toBe(false);

      // Second trip
      for (let i = 0; i < breaker.failureThreshold; i++) {
        breaker.recordFailure(TEST_URL);
      }
      expect(breaker.isOpen(TEST_URL)).toBe(true);
    });
  });

  describe("Pruning & Size Limits", () => {
    test("should prune entries with zero failures and expired timeout", () => {
      const host = "stale.com";
      breaker.states.set(host, {
        failures: 0,
        nextAttempt: Date.now() - EXPIRED_OFFSET_MS,
      });

      breaker.prune();
      expect(breaker.states.has(host)).toBe(false);
    });

    test("should NOT prune entries with > 0 failures even if expired", () => {
      const host = "failing.com";
      breaker.states.set(host, {
        failures: 1,
        nextAttempt: Date.now() - EXPIRED_OFFSET_MS,
      });

      breaker.prune();
      expect(breaker.states.has(host)).toBe(true);
    });

    test("should NOT prune entries with 0 failures if NOT expired", () => {
      const host = "active.com";
      const FUTURE_MS = 10000;
      breaker.states.set(host, {
        failures: 0,
        nextAttempt: Date.now() + FUTURE_MS,
      });

      breaker.prune();
      expect(breaker.states.has(host)).toBe(true);
    });

    test("should enforce max size limit via LRU eviction", () => {
      const TEST_MAX_SIZE = 10;
      Object.defineProperty(breaker, "maxSize", { value: TEST_MAX_SIZE });

      const TOTAL_ENTRIES = TEST_MAX_SIZE + EXTRA_ENTRIES;
      for (let i = 0; i < TOTAL_ENTRIES; i++) {
        breaker.recordFailure(`https://host-${i}.com`);
      }

      breaker.prune();
      expect(breaker.states.size).toBeLessThanOrEqual(TEST_MAX_SIZE);
    });

    test("should evict oldest entries when exceeding maxSize", () => {
      const TEST_MAX_SIZE = 5;
      Object.defineProperty(breaker, "maxSize", { value: TEST_MAX_SIZE });

      for (let i = 0; i < TEST_MAX_SIZE + EVICTION_EXTRA; i++) {
        breaker.recordFailure(`https://host-${i}.com`);
      }

      breaker.prune();

      // First 3 entries should have been evicted (Map iterates insertion order)
      expect(breaker.states.has("host-0.com")).toBe(false);
      expect(breaker.states.has("host-1.com")).toBe(false);
      expect(breaker.states.has(`host-${EVICTION_EXTRA_OFFSET}.com`)).toBe(
        false,
      );

      // Later entries should remain
      expect(
        breaker.states.has(`host-${TEST_MAX_SIZE + EVICTION_EXTRA_OFFSET}.com`),
      ).toBe(true);
    });

    test("should trigger periodic cleanup via interval", () => {
      const pruneSpy = jest.spyOn(breaker, "prune");

      jest.advanceTimersByTime(
        FORWARDING_CONSTS.CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS,
      );

      expect(pruneSpy).toHaveBeenCalled();
      pruneSpy.mockRestore();
    });
  });

  describe("Error Handling", () => {
    test("should return false for invalid URL in isOpen", () => {
      expect(breaker.isOpen("not-a-url")).toBe(false);
    });

    test("should silently handle invalid URL in recordFailure", () => {
      expect(() => breaker.recordFailure("not-a-url")).not.toThrow();
      expect(breaker.states.size).toBe(0);
    });

    test("should silently handle invalid URL in recordSuccess", () => {
      expect(() => breaker.recordSuccess("not-a-url")).not.toThrow();
    });
  });

  describe("Cleanup (destroy)", () => {
    test("should clear cleanup interval on destroy", () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      breaker.destroy();
      expect(clearIntervalSpy).toHaveBeenCalledWith(breaker.cleanupInterval);
      clearIntervalSpy.mockRestore();
    });

    test("should handle destroy when cleanupInterval is falsy", () => {
      // Simulate a case where cleanupInterval is already cleared
      Object.defineProperty(breaker, "cleanupInterval", { value: null });
      expect(() => breaker.destroy()).not.toThrow();
    });
  });
});
