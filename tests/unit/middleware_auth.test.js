/**
 * @file tests/unit/middleware_auth.test.js
 * @description Unit tests for the authentication middleware.
 */

import { jest } from '@jest/globals';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

// Mock dependencies
jest.unstable_mockModule('../../src/utils/auth.js', () => ({
    validateAuth: jest.fn()
}));
jest.unstable_mockModule('../../src/routes/utils.js', () => ({
    sendUnauthorizedResponse: jest.fn()
}));

const { validateAuth } = await import('../../src/utils/auth.js');
const { sendUnauthorizedResponse } = await import('../../src/routes/utils.js');
const { createAuthMiddleware } = await import('../../src/middleware/auth.js');
const { HTTP_STATUS, HTTP_HEADERS, HTTP_STATUS_MESSAGES } = await import('../../src/consts/http.js');

import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';

describe('Auth Middleware', () => {
    /** @type {import('../../src/typedefs.js').CustomRequest} */
    let mockReq;
    /** @type {Response} */
    let mockRes;
    /** @type {NextFunction} */
    let mockNext;
    /** @type {jest.Mock} */
    let mockGetAuthKey;
    /** @type {RequestHandler} */
    let middleware;

    const MOCK_AUTH_KEY = 'mock-auth-key';

    beforeEach(() => {
        mockReq = createMockRequest();
        mockRes = createMockResponse();
        mockNext = createMockNextFunction();
        mockGetAuthKey = jest.fn().mockReturnValue(MOCK_AUTH_KEY);
        middleware = createAuthMiddleware(/** @type {() => string} */(mockGetAuthKey));

        jest.clearAllMocks();
    });

    describe('createAuthMiddleware', () => {
        it('should bypass auth and return 200 OK for Apify readiness probe', () => {
            mockReq.headers[HTTP_HEADERS.APIFY_READINESS] = '1';

            middleware(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
            expect(mockRes.send).toHaveBeenCalledWith(HTTP_STATUS_MESSAGES[HTTP_STATUS.OK]);
            expect(validateAuth).not.toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should call validateAuth and if invalid, call sendUnauthorizedResponse', () => {
            const authError = 'Invalid Auth Token';
            jest.mocked(validateAuth).mockReturnValue({ isValid: false, error: authError });

            middleware(mockReq, mockRes, mockNext);

            expect(mockGetAuthKey).toHaveBeenCalled();
            expect(validateAuth).toHaveBeenCalledWith(mockReq, MOCK_AUTH_KEY);
            expect(sendUnauthorizedResponse).toHaveBeenCalledWith(mockReq, mockRes, { error: authError });
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should call validateAuth and if valid, call next()', () => {
            jest.mocked(validateAuth).mockReturnValue({ isValid: true });

            middleware(mockReq, mockRes, mockNext);

            expect(mockGetAuthKey).toHaveBeenCalled();
            expect(validateAuth).toHaveBeenCalledWith(mockReq, MOCK_AUTH_KEY);
            expect(mockNext).toHaveBeenCalled();
            expect(sendUnauthorizedResponse).not.toHaveBeenCalled();
        });
    });
});
