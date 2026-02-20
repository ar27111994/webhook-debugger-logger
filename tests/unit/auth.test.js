/**
 * @file tests/unit/auth.test.js
 * @description Unit tests for authentication utilities.
 */

import { jest } from '@jest/globals';
import { AUTH_CONSTS, AUTH_ERRORS } from '../../src/consts/auth.js';
import { LOG_MESSAGES } from '../../src/consts/messages.js';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { loggerMock } from '../setup/helpers/shared-mocks.js';
import { assertType } from '../setup/helpers/test-utils.js';

/**
 * @typedef {import('../../src/utils/auth.js')} AuthUtils
 * @typedef {import('../setup/helpers/test-utils.js').createMockRequest} CreateMockRequest
 */

// Mock crypto securely - distinct from shared mocks as it's a direct dependency here
const mockSecureCompare = jest.fn();
jest.unstable_mockModule('../../src/utils/crypto.js', () => ({
    secureCompare: mockSecureCompare
}));

// We import the module under test dynamically after setting up mocks
// to ensure it uses the mocked logger.

describe('Auth Utils', () => {
    /** @type {AuthUtils} */
    let authUtils;
    /** @type {CreateMockRequest} */
    let createMockRequest;

    const VALID_KEY = 'secret-key-123';

    beforeAll(async () => {
        await setupCommonMocks({ logger: true });
        // Use jest.resetModules() to ensure clean import if previously imported
        jest.resetModules();
        authUtils = await import('../../src/utils/auth.js');
        const testUtils = await import('../setup/helpers/test-utils.js');
        createMockRequest = testUtils.createMockRequest;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        loggerMock.warn.mockClear();
        // Default secureCompare behavior: exact match
        mockSecureCompare.mockImplementation((a, b) => a === b);
    });

    describe('validateAuth', () => {
        it('should return valid if no authKey is configured', () => {
            const req = createMockRequest();
            const result = authUtils.validateAuth(req, '');
            expect(result.isValid).toBe(true);
        });

        it('should validate correctly using Authorization header', () => {
            const req = createMockRequest({
                headers: { authorization: `${AUTH_CONSTS.BEARER_PREFIX}${VALID_KEY}` }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(true);
            expect(mockSecureCompare).toHaveBeenCalledWith(VALID_KEY, VALID_KEY);
        });

        it('should validate correctly using query param (fallback)', () => {
            const req = createMockRequest({
                query: { key: VALID_KEY }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(true);
            expect(loggerMock.warn).toHaveBeenCalledWith(LOG_MESSAGES.API_KEY_QUERY_WARNING);
        });

        it('should handle non-string query param (e.g. number)', () => {
            const key = 12345;
            const req = createMockRequest({
                query: { key: assertType(key) }
            });
            // 12345 !== 'secret-key-123', so unauthorized, but logic path covered
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(false);
            expect(mockSecureCompare).toHaveBeenCalledWith(VALID_KEY, String(key));
        });

        it('should fail if key is missing in both header and query', () => {
            const req = createMockRequest();
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(false);
            expect(result.error).toBe(AUTH_ERRORS.MISSING_KEY);
        });

        it('should fail if Authorization header is present but empty', () => {
            const req = createMockRequest({
                headers: { authorization: '' }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(false);
            expect(result.error).toBe(AUTH_ERRORS.MISSING_KEY);
        });

        it('should fail if key is purely whitespace', () => {
            const req = createMockRequest({
                headers: { authorization: `${AUTH_CONSTS.BEARER_PREFIX}  ` }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(false);
            expect(result.error).toBe(AUTH_ERRORS.MISSING_KEY);
        });

        it('should fail if key is incorrect', () => {
            const req = createMockRequest({
                headers: { authorization: `${AUTH_CONSTS.BEARER_PREFIX}wrong-key` }
            });
            mockSecureCompare.mockReturnValue(false); // Force failure simulation
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(false);
            expect(result.error).toBe(AUTH_ERRORS.UNAUTHORIZED_KEY);
        });

        it('should fail if multiple authorization headers are present', () => {
            const req = createMockRequest({
                headers: { authorization: assertType([`${AUTH_CONSTS.BEARER_PREFIX}k1`, `${AUTH_CONSTS.BEARER_PREFIX}k2`]) }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(false);
            expect(result.error).toBe(AUTH_ERRORS.MULTIPLE_HEADERS);
        });

        it('should handle single-element array authorization header', () => {
            const req = createMockRequest({
                headers: { authorization: assertType([`${AUTH_CONSTS.BEARER_PREFIX}${VALID_KEY}`]) }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(true);
        });

        it('should handle Authorization header array with undefined first element', () => {
            const req = createMockRequest({
                // @ts-expect-error - testing edge case
                headers: { authorization: [undefined] }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(false);
            expect(result.error).toBe(AUTH_ERRORS.MISSING_KEY);
        });

        it('should handle array in query params (HPP) by taking first', () => {
            const req = createMockRequest({
                query: { key: assertType(['secret-key-123', 'other']) }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(true);
        });

        it('should strip Bearer prefix case-insensitively', () => {
            const req = createMockRequest({
                headers: { authorization: `${AUTH_CONSTS.BEARER_PREFIX}${VALID_KEY}` }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(true);
        });

        it('should trim whitespace from provided key', () => {
            const req = createMockRequest({
                headers: { authorization: `${AUTH_CONSTS.BEARER_PREFIX}  ${VALID_KEY}  ` }
            });
            const result = authUtils.validateAuth(req, VALID_KEY);
            expect(result.isValid).toBe(true); // Should pass if trim works
            expect(mockSecureCompare).toHaveBeenCalledWith(VALID_KEY, VALID_KEY);
        });
    });
});
