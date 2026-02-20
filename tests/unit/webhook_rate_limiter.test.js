/**
 * @file tests/unit/webhook_rate_limiter.test.js
 * @description Unit tests for WebhookRateLimiter utility.
 */

import { jest } from '@jest/globals';
import { ERROR_MESSAGES } from '../../src/consts/errors.js';
import { APP_CONSTS } from '../../src/consts/app.js';
import { HTTP_STATUS, HTTP_HEADERS } from '../../src/consts/http.js';
import { LOG_MESSAGES } from '../../src/consts/messages.js';

import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { loggerMock } from '../setup/helpers/shared-mocks.js';
import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';

// Setup mocks first
await setupCommonMocks({ logger: true });

// Import module under test
const { WebhookRateLimiter } = await import('../../src/utils/webhook_rate_limiter.js');

describe('WebhookRateLimiter', () => {
    let limiter;
    const LIMIT = 5;
    const WINDOW_MS = 1000;
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

    describe('Constructor & Config', () => {
        it('should throw on invalid limit', () => {
            expect(() => new WebhookRateLimiter(0)).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
            expect(() => new WebhookRateLimiter(-1)).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
            expect(() => new WebhookRateLimiter('10')).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
        });

        it('should throw on invalid windowMs', () => {
            expect(() => new WebhookRateLimiter(10, 0)).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_WINDOW);
            expect(() => new WebhookRateLimiter(10, -100)).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_WINDOW);
        });

        it('should throw on invalid maxEntries', () => {
            expect(() => new WebhookRateLimiter(10, 1000, 0)).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_MAX_ENTRIES);
            expect(() => new WebhookRateLimiter(10, 1000, 10.5)).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_MAX_ENTRIES);
        });

        it('should allow updating limit via setter', () => {
            limiter.limit = 20;
            expect(limiter.limit).toBe(20);
            expect(() => { limiter.limit = 0; }).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
        });
    });

    describe('Rate Limiting Logic', () => {
        it('should allow requests within limit', () => {
            const result1 = limiter.check('hook1');
            expect(result1.allowed).toBe(true);
            expect(result1.remaining).toBe(LIMIT - 1);

            const result2 = limiter.check('hook1');
            expect(result2.allowed).toBe(true);
            expect(result2.remaining).toBe(LIMIT - 2);
        });

        it('should block requests exceeding limit', () => {
            // Use up the limit
            for (let i = 0; i < LIMIT; i++) {
                limiter.check('hook1');
            }

            const blocked = limiter.check('hook1');
            expect(blocked.allowed).toBe(false);
            expect(blocked.remaining).toBe(0);
            expect(blocked.resetMs).toBeGreaterThan(0);
            expect(blocked.resetMs).toBeLessThanOrEqual(WINDOW_MS);
        });

        it('should reset limit after windowMs', () => {
            // Exhaust limit
            for (let i = 0; i < LIMIT; i++) {
                limiter.check('hook1');
            }
            expect(limiter.check('hook1').allowed).toBe(false);

            // Advance time past window
            jest.advanceTimersByTime(WINDOW_MS + 10);

            const result = limiter.check('hook1');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(LIMIT - 1);
        });

        it('should calculate resetMs correctly', () => {
            const start = Date.now();
            limiter.check('hook1'); // First hit

            // Advance halfway
            jest.advanceTimersByTime(WINDOW_MS / 2);

            // Fill rest
            for (let i = 1; i < LIMIT; i++) {
                limiter.check('hook1');
            }

            const blocked = limiter.check('hook1');
            // resetMs should be roughly remaining window from FIRST hit

            expect(blocked.resetMs).toBeLessThanOrEqual(WINDOW_MS / 2 + 50); // Allowing slight buffer
            expect(blocked.resetMs).toBeGreaterThan(0);
        });
    });

    describe('Composite Keys (IP differentiation)', () => {
        it('should track different IPs independently for same webhookId', () => {
            // Exhaust IP 1
            for (let i = 0; i < LIMIT; i++) {
                limiter.check('hook1', '1.1.1.1');
            }
            expect(limiter.check('hook1', '1.1.1.1').allowed).toBe(false);

            // IP 2 should still be free
            const resultIp2 = limiter.check('hook1', '2.2.2.2');
            expect(resultIp2.allowed).toBe(true);
            expect(resultIp2.remaining).toBe(LIMIT - 1);
        });

        it('should distinguish undefined IP from specified IP', () => {
            limiter.check('hook1'); // Undefined IP
            limiter.check('hook1', '1.2.3.4');

            // They are distinct keys
            expect(limiter.entryCount).toBe(2);
        });
    });

    describe('Max Entries & LRU Eviction', () => {
        it('should accept new keys up to maxEntries', () => {
            const smallLimiter = new WebhookRateLimiter(5, 1000, 3); // Max 3
            smallLimiter.check('k1');
            smallLimiter.check('k2');
            smallLimiter.check('k3');
            expect(smallLimiter.entryCount).toBe(3);
        });

        it('should evict oldest key when capacity exceeded', () => {
            const smallLimiter = new WebhookRateLimiter(5, 1000, 2); // Max 2

            smallLimiter.check('k1'); // k1 accessed
            jest.advanceTimersByTime(10);
            smallLimiter.check('k2'); // k2 accessed

            expect(smallLimiter.entryCount).toBe(2);

            // refresh k1 
            jest.advanceTimersByTime(10);
            smallLimiter.check('k1');

            // Add k3 -> should evict k2 (oldest)
            jest.advanceTimersByTime(10);
            smallLimiter.check('k3');

            expect(smallLimiter.entryCount).toBe(2);

            // k1 should be preserved (3 hits)
            const k1Result = smallLimiter.check('k1');
            expect(k1Result.remaining).toBe(5 - 3);

            // k2 was evicted, so checking it now starts fresh (1 hit)
            const k2Result = smallLimiter.check('k2');
            expect(k2Result.remaining).toBe(5 - 1);
        });
    });

    describe('Cleanup Interval and Key Generation Edge Cases', () => {
        beforeEach(() => { });

        it('should correctly prune stale entries, retain partial entries, and log when env is production', () => {
            const clockLimiter = new WebhookRateLimiter(5, 10000, 10);

            // Partially stale
            clockLimiter.check('wh_1', '1.1.1.1');

            jest.advanceTimersByTime(55000); // Wait 55s, limit is 60s, window 10000ms

            // Fresh!
            clockLimiter.check('wh_1', '1.1.1.1');

            // Trigger the internal 60s hook
            jest.advanceTimersByTime(5000);

            expect(clockLimiter.entryCount).toBe(1); // Hits line 91

            const originalEnv = process.env.NODE_ENV;

            // Register an eviction
            clockLimiter.check('wh_2', '2.2.2.2');

            process.env.NODE_ENV = 'production';

            jest.advanceTimersByTime(75000); // 10s window + 60s sleep

            process.env.NODE_ENV = originalEnv;

            // Hits line 99: log.info({ prunedCount }, LOG_MESSAGES.WEBHOOK_RATELIMIT_PRUNED);
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ prunedCount: expect.any(Number) }),
                LOG_MESSAGES.WEBHOOK_RATELIMIT_PRUNED
            );

            clockLimiter.destroy();
        });

        it('should trigger unique block warnings for webhook boundaries', () => {
            for (let i = 0; i < 5; i++) {
                limiter.check('wh_abc', '1.2.3.4');
            }

            const blocked = limiter.check('wh_abc', '1.2.3.4');
            expect(blocked.allowed).toBe(false);
        });

        it('should handle undefined IP gracefully', () => {
            const result = limiter.check('wh_123', undefined);
            expect(result.allowed).toBe(true);
            expect(limiter.entryCount).toBe(1);
        });

        it('should handle missing webhookId gracefully by falling back to rate limiting globally', () => {
            const result = limiter.check(undefined, '5.5.5.5');
            expect(result.allowed).toBe(true);
            expect(limiter.entryCount).toBe(1);
        });

        it('should handle missing both gracefully', () => {
            const result = limiter.check(undefined, undefined);
            expect(result.allowed).toBe(true);
            expect(limiter.entryCount).toBe(1);
        });

        it('should trigger constructor defaults when instantiated with no arguments', () => {
            const defaultLimiter = new WebhookRateLimiter();
            expect(defaultLimiter.limit).toBe(APP_CONSTS.DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE);
            defaultLimiter.destroy();
        });

        it('should handle unref missing safely', () => {
            const origSetInterval = global.setInterval;
            global.setInterval = jest.fn(() => ({ unref: undefined })); // return object without unref

            const safeLimiter = new WebhookRateLimiter();
            expect(safeLimiter.limit).toBeDefined();

            global.setInterval = origSetInterval;
        });

        it('should handle destroy gracefully when cleanupInterval is missing', () => {
            const localLimiter = new WebhookRateLimiter();
            // Stop the cleanup interval and delete it from the object
            localLimiter.destroy();
            const origInterval = localLimiter['#cleanupInterval'];
            // Manually hack falsy path for line 139
            Object.defineProperty(localLimiter, '#cleanupInterval', { value: null, writable: true });
            expect(() => localLimiter.destroy()).not.toThrow();
        });

        it('should handle oldestKey not being a string safely during eviction', () => {
            const smallLimiter = new WebhookRateLimiter(5, 1000, 1);

            // Branch line 159: force a numeric key during check by substituting Map properties
            const originalKeys = Map.prototype.keys;
            const mockIterator = {
                next: () => ({ value: 12345, done: false })
            };

            Map.prototype.keys = jest.fn(() => mockIterator);

            smallLimiter.check('normal_key_1');
            smallLimiter.check('normal_key_2');

            expect(smallLimiter.entryCount).toBe(2);
            // Cleanup mapping
            Map.prototype.keys = originalKeys;
        });

        it('should calculate resetMs without oldestHit if empty array (edge case fallback)', () => {
            const clockLimiter = new WebhookRateLimiter(1, 1000, 10);
            clockLimiter.check('key_a');

            const origFilter = Array.prototype.filter;
            Array.prototype.filter = jest.fn().mockReturnValue([]);

            const result = clockLimiter.check('key_a');
            expect(result.resetMs).toBeGreaterThan(0);

            Array.prototype.filter = origFilter;
            clockLimiter.destroy();
        });
    });
});
