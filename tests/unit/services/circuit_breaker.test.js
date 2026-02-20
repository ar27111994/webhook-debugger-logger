/**
 * @file tests/unit/services/circuit_breaker.test.js
 * @description Unit tests for CircuitBreaker service.
 */

import { jest } from '@jest/globals';
import { CircuitBreaker } from '../../../src/services/CircuitBreaker.js';
import { FORWARDING_CONSTS } from '../../../src/consts/app.js';

describe('CircuitBreaker', () => {
    /** @type {CircuitBreaker} */
    let circuitBreaker;

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
    });

    describe('state management', () => {
        const HOST = 'https://api.example.com/webhook';
        const HOSTNAME = 'api.example.com';
        const STATE_ERROR = 'State should be defined';
        const INVALID_URL = 'invalid-url';

        it('should record failures correctly', () => {
            circuitBreaker.recordFailure(HOST);
            const state = circuitBreaker.states.get(HOSTNAME);
            if (!state) throw new Error(STATE_ERROR);
            expect(state).toBeDefined();
            expect(state.failures).toBe(1);
            expect(state.nextAttempt).toBeGreaterThan(Date.now());
        });

        it('should increment failure count on consecutive failures', () => {
            circuitBreaker.recordFailure(HOST);
            circuitBreaker.recordFailure(HOST);
            const state = circuitBreaker.states.get(HOSTNAME);
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
                circuitBreaker.recordFailure(HOST);
            }

            expect(circuitBreaker.isOpen(HOST)).toBe(true);
        });

        it('should reset state on success', () => {
            circuitBreaker.recordFailure(HOST);
            expect(circuitBreaker.states.has(HOSTNAME)).toBe(true);

            circuitBreaker.recordSuccess(HOST);
            expect(circuitBreaker.states.has(HOSTNAME)).toBe(false);
        });

        it('should handle invalid URLs gracefully in recordSuccess', () => {
            expect(() => circuitBreaker.recordSuccess(INVALID_URL)).not.toThrow();
        });

        it('should handle invalid URLs gracefully in isOpen', () => {
            expect(circuitBreaker.isOpen(INVALID_URL)).toBe(false);
        });
    });

    describe('prune', () => {
        const PRUNE_HOST = 'api.example.com';

        it('should remove expired entries with no failures', () => {
            // Mock state manually
            circuitBreaker.states.set(PRUNE_HOST, {
                failures: 0,
                nextAttempt: Date.now() - FORWARDING_CONSTS.CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS // In the past
            });

            circuitBreaker.prune();
            expect(circuitBreaker.states.has(PRUNE_HOST)).toBe(false);
        });

        it('should NOT remove active failed states', () => {
            circuitBreaker.states.set(PRUNE_HOST, {
                failures: 1,
                nextAttempt: Date.now() + FORWARDING_CONSTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS // In the future
            });

            circuitBreaker.prune();
            expect(circuitBreaker.states.has(PRUNE_HOST)).toBe(true);
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
});
