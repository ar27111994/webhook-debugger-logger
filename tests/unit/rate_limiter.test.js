/**
 * @file tests/unit/rate_limiter.test.js
 * @description Unit tests for RateLimiter utility.
 */

import { jest } from '@jest/globals';
import { ERROR_MESSAGES } from '../../src/consts/errors.js';
import { LOG_MESSAGES } from '../../src/consts/messages.js';
import { HTTP_HEADERS, HTTP_STATUS } from '../../src/consts/http.js';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { loggerMock } from '../setup/helpers/shared-mocks.js';
import { createMockRequest, createMockResponse, createMockNextFunction, assertType } from '../setup/helpers/test-utils.js';
import { APP_CONSTS, ENV_VALUES, ENV_VARS } from '../../src/consts/app.js';

/**
 * @typedef {import('../../src/utils/rate_limiter.js').RateLimiter} RateLimiter
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

// Setup common mocks before importing the module
await setupCommonMocks({ logger: true });
const { RateLimiter } = await import('../../src/utils/rate_limiter.js');

describe('RateLimiter', () => {
    /**
     * @type {RateLimiter}
     */
    let limiter;
    const LIMIT = 5;
    const WINDOW_MS = APP_CONSTS.MS_PER_SECOND;
    const MAX_ENTRIES = 10;

    beforeEach(() => {
        jest.useFakeTimers();
        limiter = new RateLimiter(LIMIT, WINDOW_MS, MAX_ENTRIES, false);
    });

    afterEach(() => {
        if (limiter) limiter.destroy();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    describe('Constructor & Config', () => {
        it('should throw on invalid windowMs', () => {
            const negativeWindowMs = -10;
            const invalidWindowMs = [
                0,
                negativeWindowMs,
                String(WINDOW_MS)
            ];

            invalidWindowMs.forEach((windowMs) => {
                expect(() => new RateLimiter(LIMIT, assertType(windowMs))).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_WINDOW);
            });
        });

        it('should throw on invalid maxEntries', () => {
            const zeroMaxEntries = 0;
            const floatMaxEntries = 10.5;
            const negativeMaxEntries = -5;
            const invalidMaxEntries = [
                zeroMaxEntries,
                floatMaxEntries,
                negativeMaxEntries
            ];

            invalidMaxEntries.forEach((maxEntries) => {
                expect(() => new RateLimiter(LIMIT, WINDOW_MS, assertType(maxEntries))).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_MAX_ENTRIES);
            });
        });

        it('should throw on invalid limit', () => {
            const negativeLimit = -1;
            const floatLimit = 1.5;
            const invalidLimit = [
                negativeLimit,
                floatLimit
            ];

            invalidLimit.forEach((limit) => {
                expect(() => new RateLimiter(assertType(limit), WINDOW_MS)).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
            });
        });

        it('should allow valid limit configuration via getter and setter', () => {
            expect(limiter.limit).toBe(LIMIT);

            const newLimit = 10;
            const negativeLimit = -1;
            limiter.limit = newLimit;
            expect(limiter.limit).toBe(newLimit);

            expect(() => { limiter.limit = negativeLimit; }).toThrow(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
        });

        it('should handle unref missing safely', () => {
            const origSetInterval = global.setInterval;
            global.setInterval = /** @type {any} */ (jest.fn(() => ({ unref: undefined })));

            const safeLimiter = new RateLimiter(LIMIT, WINDOW_MS);
            expect(safeLimiter.limit).toBeDefined();

            global.setInterval = origSetInterval;
            safeLimiter.destroy();
        });
    });

    describe('Helper Methods', () => {
        it('isValidIp should validate IP addresses', () => {
            expect(limiter.isValidIp('127.0.0.1')).toBe(true);
            expect(limiter.isValidIp('::1')).toBe(true);
            expect(limiter.isValidIp('invalid')).toBe(false);
            expect(limiter.isValidIp(null)).toBe(false);
        });

        it('extractFirstValidIp should extract IP from headers correctly', () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const ip = '192.168.1.1';
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const ip2 = '10.0.0.1';
            const ip3 = '192.168.1.1, 10.0.0.1';
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const ip4 = ['10.0.0.1', '192.168.1.1'];
            const ip5 = 'invalid-ip, 127.0.0.1';
            const ip6 = undefined;
            const ip7 = null;
            /** @type {string[]} */
            const ip8 = [];

            expect(limiter.extractFirstValidIp(ip)).toBe(ip);
            expect(limiter.extractFirstValidIp(ip3)).toBe(ip);
            expect(limiter.extractFirstValidIp(ip4)).toBe(ip2);
            expect(limiter.extractFirstValidIp(ip5)).toBeUndefined();
            expect(limiter.extractFirstValidIp(ip6)).toBeUndefined();
            expect(limiter.extractFirstValidIp(assertType(ip7))).toBeUndefined();
            expect(limiter.extractFirstValidIp(ip8)).toBeUndefined();
        });

        it('maskIp should handle obfuscation securely', () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(limiter.maskIp('192.168.1.50')).toBe(`192.168.1${LOG_MESSAGES.MASK_IPV4_SUFFIX}`);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(limiter.maskIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(`2001:0db8${LOG_MESSAGES.MASK_IPV6_SUFFIX}`);
            expect(limiter.maskIp(undefined)).toBe(LOG_MESSAGES.MASK_HIDDEN);
        });

        it('hasIp should return false in production environment', () => {
            const originalEnv = process.env[ENV_VARS.NODE_ENV];
            process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(limiter.hasIp('1.2.3.4')).toBe(false);
            process.env[ENV_VARS.NODE_ENV] = originalEnv;
        });
    });

    describe('Middleware rate limiting', () => {
        /**
         * @type {Request}
         */
        let req;
        /**
         * @type {Response}
         */
        let res;
        /**
         * @type {NextFunction}
         */
        let next;
        /**
         * @type {RequestHandler}
         */
        let mw;

        beforeEach(() => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            req = createMockRequest({ ip: '1.2.3.4' });
            res = createMockResponse();
            next = createMockNextFunction();
            mw = limiter.middleware();
        });

        it('should allow valid request and set rate limit headers', () => {
            mw(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_RATELIMIT_LIMIT, LIMIT);
            expect(res.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_RATELIMIT_REMAINING, LIMIT - 1);
            expect(res.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_RATELIMIT_RESET, expect.any(Number));
        });

        it('should block requests consistently exceeding limit', () => {
            // Deplete limit
            for (let i = 0; i < LIMIT; i++) {
                mw(req, res, next);
                jest.mocked(next).mockClear();
            }

            // Next one should block
            mw(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.TOO_MANY_REQUESTS);
            expect(res.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.RETRY_AFTER, Math.ceil(WINDOW_MS / APP_CONSTS.MS_PER_SECOND));
        });

        it('should return 400 when missing IP identifier', () => {
            req = createMockRequest({ ip: undefined, headers: { [HTTP_HEADERS.X_SIMULATE_NO_IP]: 'true' } });
            mw(req, res, next);
            expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.any(Object), LOG_MESSAGES.RATELIMIT_REJECT_NO_IP);
        });

        it('should log eviction when maxEntries limits are met in non-test env', () => {
            const smallLimiter = new RateLimiter(LIMIT, WINDOW_MS, 1, false);
            const strictMw = smallLimiter.middleware();

            // Track one IP
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            strictMw(createMockRequest({ ip: '1.1.1.1' }), createMockResponse(), createMockNextFunction());

            const originalEnv = process.env[ENV_VARS.NODE_ENV];
            process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION; // bypass test check

            // Track second IP, should evict first and log (line 261)
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            strictMw(createMockRequest({ ip: '2.2.2.2' }), createMockResponse(), createMockNextFunction());

            process.env.NODE_ENV = originalEnv;

            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ evictedIp: `1.1.1${LOG_MESSAGES.MASK_IPV4_SUFFIX}`, maxEntries: 1 }),
                LOG_MESSAGES.RATELIMIT_EVICTED
            );
            smallLimiter.destroy();
        });

        it('should enforce LRU mapping correctly (maxEntries limits)', () => {
            const maxEntries = 2;
            const smallLimiter = new RateLimiter(LIMIT, WINDOW_MS, maxEntries, false);
            const strictMw = smallLimiter.middleware();

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqA = createMockRequest({ ip: '1.1.1.1' });
            strictMw(reqA, res, next); // 1.1.1.1 tracked

            // move time a bit
            const time = 10;
            jest.advanceTimersByTime(time);

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqB = createMockRequest({ ip: '2.2.2.2' });
            strictMw(reqB, res, next); // 2.2.2.2 tracked - now at Max Entries (2)

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(smallLimiter.hasIp('1.1.1.1')).toBe(true);

            jest.advanceTimersByTime(time);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqC = createMockRequest({ ip: '3.3.3.3' });
            strictMw(reqC, res, next); // 3.3.3.3 tracked -> 1.1.1.1 evicted

            expect(smallLimiter.entryCount).toBe(maxEntries);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(smallLimiter.hasIp('1.1.1.1')).toBe(false);
            smallLimiter.destroy();
        });

        it('should bump TTL of IP if accessed again', () => {
            const maxEntries = 2;
            const smallLimiter = new RateLimiter(LIMIT, WINDOW_MS, maxEntries, false);
            const strictMw = smallLimiter.middleware();

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqA = createMockRequest({ ip: '1.1.1.1' });
            strictMw(reqA, res, next);

            const time = 10;
            jest.advanceTimersByTime(time);

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqB = createMockRequest({ ip: '2.2.2.2' });
            strictMw(reqB, res, next);

            jest.advanceTimersByTime(time);
            strictMw(reqA, res, next); // Hit 1.1.1.1 again, making it "newest"

            jest.advanceTimersByTime(time);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqC = createMockRequest({ ip: '3.3.3.3' });
            strictMw(reqC, res, next); // Should evict 2.2.2.2 now

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(smallLimiter.hasIp('2.2.2.2')).toBe(false);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(smallLimiter.hasIp('1.1.1.1')).toBe(true);
            smallLimiter.destroy();
        });

        it('should trust proxy correctly when configured', () => {
            const maxEntries = 10;
            const proxyLimiter = new RateLimiter(LIMIT, WINDOW_MS, maxEntries, true);
            const proxyMw = proxyLimiter.middleware();

            const proxyReq = createMockRequest({
                // eslint-disable-next-line sonarjs/no-hardcoded-ip
                ip: '10.0.0.1', // local router
                headers: {
                    [HTTP_HEADERS.X_FORWARDED_FOR]: '9.9.9.9, 10.0.0.1' // original user IP
                }
            });

            proxyMw(proxyReq, res, next);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(proxyLimiter.hasIp('9.9.9.9')).toBe(true);
            proxyLimiter.destroy();
        });

        it('should fallback securely when trust proxy is off', () => {
            const noProxyMw = limiter.middleware(); // trustProxy = false
            const proxyReq = createMockRequest({
                // eslint-disable-next-line sonarjs/no-hardcoded-ip
                ip: '10.0.0.1',
                headers: {
                    [HTTP_HEADERS.X_FORWARDED_FOR]: '9.9.9.9, 10.0.0.1',
                    [HTTP_HEADERS.X_REAL_IP]: '8.8.8.8'
                }
            });

            noProxyMw(proxyReq, res, next);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(limiter.hasIp('10.0.0.1')).toBe(true);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(limiter.hasIp('9.9.9.9')).toBe(false);
        });

        it('should fallback to raw ip when trust proxy is true but headers are missing', () => {
            const proxyLimiter = new RateLimiter(LIMIT, WINDOW_MS, 10, true);
            const proxyMw = proxyLimiter.middleware();

            const proxyReq = createMockRequest({
                // eslint-disable-next-line sonarjs/no-hardcoded-ip
                ip: '10.0.0.1'
                // omit all proxy headers
            });

            proxyMw(proxyReq, res, next);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(proxyLimiter.hasIp('10.0.0.1')).toBe(true);
            proxyLimiter.destroy();
        });

        it('should fallback to X-Real-IP when X-Forwarded-For is missing and trustProxy is true', () => {
            const maxEntries = 10;
            const proxyLimiter = new RateLimiter(LIMIT, WINDOW_MS, maxEntries, true);
            const proxyMw = proxyLimiter.middleware();

            const proxyReq = createMockRequest({
                // eslint-disable-next-line sonarjs/no-hardcoded-ip
                ip: '10.0.0.1',
                headers: {
                    // eslint-disable-next-line sonarjs/no-hardcoded-ip
                    [HTTP_HEADERS.X_REAL_IP]: '8.8.8.8'
                }
            });

            proxyMw(proxyReq, res, next);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(proxyLimiter.hasIp('8.8.8.8')).toBe(true);
            proxyLimiter.destroy();
        });

        it('should handle oldestKey not being a string safely during eviction', () => {
            const smallLimiter = new RateLimiter(LIMIT, WINDOW_MS, 1, false);
            const strictMw = smallLimiter.middleware();

            // Mock Map.prototype.keys to return a non-string key
            const originalKeys = Map.prototype.keys;
            const mockIterator = {
                next: () => ({ value: 12345, done: false }) // Number instead of string
            };
            Map.prototype.keys = /** @type {any} */ (jest.fn(() => mockIterator));

            // Trigger eviction
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqA = createMockRequest({ ip: '1.1.1.1' });
            strictMw(reqA, res, next);

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const reqB = createMockRequest({ ip: '2.2.2.2' });
            strictMw(reqB, res, next);

            expect(smallLimiter.entryCount).toBe(1 + 1);

            Map.prototype.keys = originalKeys;
            smallLimiter.destroy();
        });
    });

    describe('Cleanup Job & Edge cases', () => {
        /** @type {RateLimiter} */
        let clockLimiter;

        const maxEntries = 10;
        const windowMs = 10000;

        beforeEach(() => {
            // Need a new limiter to precisely control its internal interval with fake timers created before it
            clockLimiter = new RateLimiter(LIMIT, windowMs, maxEntries, false); // Long window: 10s. Interval is hardcoded to 60s
        });

        afterEach(() => {
            if (clockLimiter) clockLimiter.destroy();
        });

        it('should prune entirely stale IPs over time', () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const req = createMockRequest({ ip: '1.2.3.4' });
            const res = createMockResponse();
            const next = createMockNextFunction();
            const mw = clockLimiter.middleware();

            mw(req, res, next);

            // advance completely past window (10s) AND interval (60s)
            const timeToAdvanceSec = 65;
            jest.advanceTimersByTime(windowMs + (timeToAdvanceSec * APP_CONSTS.MS_PER_SECOND));

            expect(clockLimiter.entryCount).toBe(0);
        });

        it('should keep fresh timestamps but drop stale ones inside the array', () => {
            const mw = clockLimiter.middleware();
            const req = createMockRequest({ ip: 'keep.me.partially' });
            const res = createMockResponse();
            const next = createMockNextFunction();

            mw(req, res, next); // time t=0 (Stale at 60s since window is 10s)

            // hit again just before interval runs
            const timeToAdvanceSec = 55;
            jest.advanceTimersByTime(timeToAdvanceSec * APP_CONSTS.MS_PER_SECOND);
            mw(req, res, next); // time t=55s -> (Fresh at 60s)

            // Trigger interval at t=60s
            const timeToAdvanceSec2 = 5;
            jest.advanceTimersByTime(timeToAdvanceSec2 * APP_CONSTS.MS_PER_SECOND);

            // IP is still there, but array is smaller (hits line 87: this.#hits.set(key, fresh))
            expect(clockLimiter.entryCount).toBe(1);
        });

        it('should log prunedCount > 0 in non-test environments', () => {
            const originalEnv = process.env[ENV_VARS.NODE_ENV];

            // Register an eviction
            const mw = clockLimiter.middleware();
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            mw(createMockRequest({ ip: 'drop.me.entirely' }), createMockResponse(), createMockNextFunction());

            process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;

            const timeToAdvanceSec = 75;
            jest.advanceTimersByTime(timeToAdvanceSec * APP_CONSTS.MS_PER_SECOND);

            process.env[ENV_VARS.NODE_ENV] = originalEnv;

            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ prunedCount: 1 }),
                LOG_MESSAGES.RATELIMIT_PRUNED
            );
        });

        it('should handle destroy gracefully when cleanupInterval is missing', () => {
            const origSetInterval = global.setInterval;
            // Force '#cleanupInterval' field to falsy value natively
            global.setInterval = /** @type {any} */ (jest.fn(() => undefined));

            const localLimiter = new RateLimiter(LIMIT, WINDOW_MS);
            expect(() => localLimiter.destroy()).not.toThrow();

            global.setInterval = origSetInterval;
        });
    });

    describe('Concurrency and Stress Tests', () => {
        /** @type {RateLimiter} */
        let stressLimiter;

        const limit = 100;
        const maxEntries = 100;
        const windowSec = 10;
        const windowMs = windowSec * APP_CONSTS.MS_PER_SECOND;

        beforeEach(() => {
            stressLimiter = new RateLimiter(limit, windowMs, maxEntries, false);
        });

        afterEach(() => {
            if (stressLimiter) stressLimiter.destroy();
        });

        it('should handle concurrent synchronous hits without corruption', () => {
            const mw = stressLimiter.middleware();
            // Simulate 50 requests coming in from the same IP at the exact same tick
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const req = createMockRequest({ ip: '8.8.8.8' });
            const resLocal = createMockResponse();
            const nextLocal = createMockNextFunction();

            const requests = 50;
            for (let i = 0; i < requests; i++) {
                mw(req, resLocal, nextLocal);
            }

            // Check state
            expect(stressLimiter.entryCount).toBe(1);
            expect(nextLocal).toHaveBeenCalledTimes(requests);
            expect(resLocal.status).not.toHaveBeenCalled();

            // Advance time strictly and hit one more time
            const timeToAdvanceSec = 5;
            jest.advanceTimersByTime(timeToAdvanceSec * APP_CONSTS.MS_PER_SECOND);
            mw(req, resLocal, nextLocal);

            expect(nextLocal).toHaveBeenCalledTimes(requests + 1);
        });
    });
});
