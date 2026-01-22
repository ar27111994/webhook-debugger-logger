/**
 * Test lifecycle helper utilities.
 *
 * These helpers standardize common beforeEach/afterEach patterns
 * to reduce boilerplate and ensure consistent test isolation.
 *
 * @module tests/helpers/test-lifecycle
 */

import { jest, beforeEach, afterEach } from "@jest/globals";

/**
 * Automatically clears all mocks before each test.
 *
 * This eliminates the need for repetitive `jest.clearAllMocks()`
 * calls in beforeEach blocks across test files.
 *
 * @example
 * describe("My Test Suite", () => {
 *   useMockCleanup();
 *
 *   test("mocks are automatically cleared", () => {
 *     const mockFn = jest.fn();
 *     mockFn();
 *     // In next test, mockFn.mock.calls will be empty
 *   });
 * });
 *
 * @example
 * // With additional setup:
 * useMockCleanup(() => {
 *   axiosMock.mockResolvedValue({ status: 200 });
 * });
 *
 * @param {() => void} [additionalSetup] - Optional function to run after clearing mocks
 */
export function useMockCleanup(additionalSetup) {
  beforeEach(() => {
    jest.clearAllMocks();
    additionalSetup?.();
  });
}

/**
 * Automatically manages fake timers for async testing.
 *
 * Sets up fake timers before each test and restores real timers after.
 * Essential for testing code with setTimeout, setInterval, or delays.
 *
 * @example
 * describe("Timer Tests", () => {
 *   useFakeTimers();
 *
 *   test("delays work correctly", async () => {
 *     const promise = someAsyncFunction();
 *     await jest.runAllTimersAsync();
 *     await promise;
 *     // Assertions...
 *   });
 * });
 */
export function useFakeTimers() {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });
}

/**
 * Automatically spies on and restores console methods.
 *
 * Useful for testing logging behavior without polluting test output.
 * Spies are automatically restored after each test.
 *
 * @example
 * describe("Error Logging", () => {
 *   const consoleSpy = useConsoleSpy("error", "warn");
 *
 *   test("logs errors correctly", () => {
 *     console.error("Test error");
 *     expect(consoleSpy.error).toHaveBeenCalledWith("Test error");
 *   });
 * });
 *
 * @param {...("log"|"error"|"warn"|"info"|"debug")} methods - Console methods to spy on
 * @returns {Record<string, jest.Spied<(...args: any[]) => void>>} Spy instances keyed by method name
 */
export function useConsoleSpy(...methods) {
  /** @type {Record<string, jest.Spied<(...args: any[]) => void>>} */
  const spies = {};

  beforeEach(() => {
    methods.forEach((method) => {
      spies[method] = jest.spyOn(console, method).mockImplementation(() => {});
    });
  });

  afterEach(() => {
    methods.forEach((method) => {
      spies[method]?.mockRestore();
    });
  });

  return spies;
}
