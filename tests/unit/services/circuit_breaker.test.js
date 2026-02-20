/**
 * @file tests/unit/services/circuit_breaker.test.js
 * @description Unit tests for CircuitBreaker service.
 */

import { jest } from '@jest/globals';
import { CircuitBreaker } from '../../../src/services/CircuitBreaker.js';
import { APP_CONSTS, FORWARDING_CONSTS } from '../../../src/consts/app.js';
import { assertType } from '../../setup/helpers/test-utils.js';

describe('CircuitBreaker', () => {
    const STATE_ERROR = 'State should be defined';
    const INVALID_TEST_URL = "invalid-url";
    /** @type {CircuitBreaker} */
    let circuitBreaker;

    const TARGET_HOSTNAME = 'api.example.com';
    const TARGET_URL = `https://${TARGET_HOSTNAME}/webhook`;

    beforeEach(() => {
        jest.useFakeTimers();
        circuitBreaker = new CircuitBreaker();
    });

    afterEach(() => {
        circuitBreaker.destroy();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    describe('initialization', () => {
        it('should initialize with default empty state', async () => {
            expect(circuitBreaker.states.size).toBe(0);
        });

        it('should perform periodic cleanup', async () => {
            const spyPrune = jest.spyOn(circuitBreaker, 'prune');
            const bufferMs = 100;
            jest.advanceTimersByTime(FORWARDING_CONSTS.CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS + bufferMs);
            expect(spyPrune).toHaveBeenCalled();
        });

        it('should handle environments where setInterval unref is not available', () => {
            const originalSetInterval = global.setInterval;
            global.setInterval = () => assertType({}); // Returns object without unref
            expect(() => {
                const cb = new CircuitBreaker();
                cb.destroy();
            }).not.toThrow();
            global.setInterval = originalSetInterval;
        });
    });

    describe('state management', () => {
        const INVALID_URL = INVALID_TEST_URL;

        it('should record failures correctly', () => {
            circuitBreaker.recordFailure(TARGET_URL);
            const state = circuitBreaker.states.get(TARGET_HOSTNAME);
            if (!state) throw new Error(STATE_ERROR);
            expect(state).toBeDefined();
            expect(state.failures).toBe(1);
            expect(state.nextAttempt).toBeGreaterThan(Date.now());
        });

        it('should increment failure count on consecutive failures', () => {
            circuitBreaker.recordFailure(TARGET_URL);
            circuitBreaker.recordFailure(TARGET_URL);
            const state = circuitBreaker.states.get(TARGET_HOSTNAME);
            if (!state) throw new Error(STATE_ERROR);
            expect(state.failures).toBe(1 + 1);
        });

        it('should handle invalid URLs gracefully in recordFailure', () => {
            expect(() => circuitBreaker.recordFailure(INVALID_URL)).not.toThrow();
            expect(circuitBreaker.states.size).toBe(0);
        });

        it('should open circuit when threshold exceeded', () => {
            // Threshold is typically 5
            for (let i = 0; i < FORWARDING_CONSTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
                circuitBreaker.recordFailure(TARGET_URL);
            }

            expect(circuitBreaker.isOpen(TARGET_URL)).toBe(true);
        });

        it('should reset state on success', () => {
            circuitBreaker.recordFailure(TARGET_URL);
            expect(circuitBreaker.states.has(TARGET_HOSTNAME)).toBe(true);

            circuitBreaker.recordSuccess(TARGET_URL);
            expect(circuitBreaker.states.has(TARGET_HOSTNAME)).toBe(false);
        });

        it('should handle invalid URLs gracefully in recordSuccess', () => {
            expect(() => circuitBreaker.recordSuccess(INVALID_URL)).not.toThrow();
        });

        it('should do nothing if recordSuccess is called for a hostname not in states', () => {
            expect(() => circuitBreaker.recordSuccess('https://not-in-state.com')).not.toThrow();
        });

        it('should handle invalid URLs gracefully in isOpen', () => {
            expect(circuitBreaker.isOpen(INVALID_URL)).toBe(false);
        });

        it('should return false for isOpen when state does not exist', () => {
            expect(circuitBreaker.isOpen('https://nonexistent.com')).toBe(false);
        });
    });

    describe('prune', () => {
        it('should remove expired entries with no failures', () => {
            // Mock state manually
            circuitBreaker.states.set(TARGET_HOSTNAME, {
                failures: 0,
                nextAttempt: Date.now() - FORWARDING_CONSTS.CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS // In the past
            });

            circuitBreaker.prune();
            expect(circuitBreaker.states.has(TARGET_HOSTNAME)).toBe(false);
        });

        it('should NOT remove active failed states', () => {
            circuitBreaker.states.set(TARGET_HOSTNAME, {
                failures: 1,
                nextAttempt: Date.now() + FORWARDING_CONSTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS // In the future
            });

            circuitBreaker.prune();
            expect(circuitBreaker.states.has(TARGET_HOSTNAME)).toBe(true);
        });

        it('should enforce maxSize limit via LRU-ish eviction', () => {
            const testMaxSize = 2;
            Object.defineProperty(circuitBreaker, 'maxSize', { value: testMaxSize });

            const futureMs = 1000;
            circuitBreaker.states.set('a.com', { failures: 1, nextAttempt: Date.now() + futureMs });
            circuitBreaker.states.set('b.com', { failures: 1, nextAttempt: Date.now() + futureMs });
            circuitBreaker.states.set('c.com', { failures: 1, nextAttempt: Date.now() + futureMs });

            expect(circuitBreaker.states.size).toBe(testMaxSize + 1);
            circuitBreaker.prune();

            expect(circuitBreaker.states.size).toBe(testMaxSize);
            // Should have removed the first inserted ('a.com') because Map iterator is insertion-ordered
            expect(circuitBreaker.states.has('a.com')).toBe(false);
            expect(circuitBreaker.states.has('b.com')).toBe(true);
            expect(circuitBreaker.states.has('c.com')).toBe(true);
        });
    });

    describe('Half-Open Recovery and Time Drift', () => {
        it('should allow a request after reset timeout, but re-open on immediate failure', () => {
            for (let i = 0; i < FORWARDING_CONSTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
                circuitBreaker.recordFailure(TARGET_URL);
            }
            expect(circuitBreaker.isOpen(TARGET_URL)).toBe(true);

            // Advance time past the reset timeout
            const bufferMs = 10;
            jest.advanceTimersByTime(FORWARDING_CONSTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + bufferMs);

            // Should now be closed (half-open state allowing a test request)
            expect(circuitBreaker.isOpen(TARGET_URL)).toBe(false);

            // If the request fails again, it should re-open immediately
            circuitBreaker.recordFailure(TARGET_URL);
            expect(circuitBreaker.isOpen(TARGET_URL)).toBe(true);
        });

        it('should handle system clock moving backwards (NTP skew) without crashing', () => {
            circuitBreaker.recordFailure(TARGET_URL);

            const originalNow = Date.now;
            const hourMs = APP_CONSTS.MS_PER_HOUR;
            Date.now = () => originalNow() - hourMs; // 1 hour in the past

            // Open shouldn't crash, it just evaluates the math
            expect(() => circuitBreaker.isOpen(TARGET_URL)).not.toThrow();

            Date.now = originalNow;
        });
    });

    describe('Security and Sanitation Checks', () => {
        it('should handle incredibly long URLs without catastrophic unhandled ReDoS', () => {
            const longUrlLength = 100000;
            const longUrl = `https://${'a'.repeat(longUrlLength)}.com`;
            // V8 URL parser is very fast, just making sure we don't blow up our own states
            expect(() => circuitBreaker.recordFailure(longUrl)).not.toThrow();
        });

        it('should handle non-string types safely through the catch block', () => {
            expect(() => circuitBreaker.recordFailure(assertType(null))).not.toThrow();
            expect(() => circuitBreaker.recordFailure(assertType(undefined))).not.toThrow();
            expect(() => circuitBreaker.recordFailure(assertType({}))).not.toThrow();

            expect(circuitBreaker.isOpen(assertType(null))).toBe(false);
            expect(circuitBreaker.isOpen(assertType(undefined))).toBe(false);
            expect(circuitBreaker.isOpen(assertType({}))).toBe(false);
        });

        it('should handle prototype pollution attempts gracefully in hostname', () => {
            const protoUrl = 'https://__proto__/';
            circuitBreaker.recordFailure(protoUrl);
            // Map handles __proto__ seamlessly
            expect(circuitBreaker.isOpen(protoUrl)).toBe(false); // Since it's 1 failure
        });

        it('should normalize hostnames irrespective of casing or port', () => {
            // Note: Node URL parsing lowercases hostnames automatically
            circuitBreaker.recordFailure(`HTTPS://${TARGET_HOSTNAME.toUpperCase()}:8080/foo`);
            circuitBreaker.recordFailure(`https://${TARGET_HOSTNAME}/bar`);

            const state = circuitBreaker.states.get(TARGET_HOSTNAME);
            if (!state) throw new Error('State should be defined');
            expect(state).toBeDefined();
            expect(state.failures).toBe(1 + 1);
        });
    });

    describe('Stress and Concurrency Limitations', () => {
        it('should handle rapid synchronous failures without blocking event loop', () => {
            const STRESS_HOST = 'https://stress.com';
            const STRESS_HOSTNAME = 'stress.com';
            const ITERATIONS = 10000;
            const start = Date.now();

            for (let i = 0; i < ITERATIONS; i++) {
                circuitBreaker.recordFailure(STRESS_HOST);
            }

            const duration = Date.now() - start;
            const durationThresholdMs = 500;
            expect(duration).toBeLessThan(durationThresholdMs);

            const state = circuitBreaker.states.get(STRESS_HOSTNAME);
            if (!state) throw new Error(STATE_ERROR);
            expect(state.failures).toBe(ITERATIONS);
            expect(circuitBreaker.isOpen(STRESS_HOST)).toBe(true);
        });
    });

    describe('destroy', () => {
        it('should handle destroy when cleanupInterval is missing securely', () => {
            const cb = new CircuitBreaker();
            cb.cleanupInterval = assertType(undefined);
            expect(() => cb.destroy()).not.toThrow();
        });
    });
});
