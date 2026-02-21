/**
 * @file tests/unit/middleware_auth.test.js
 * @description Unit tests for the authentication middleware.
 */

import { jest } from '@jest/globals';

/**
 * @typedef {import('../../src/typedefs.js').CustomRequest} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
await setupCommonMocks({ auth: true, routeUtils: true });

const { authMock, routeUtilsMock } = await import('../setup/helpers/shared-mocks.js');

const { createAuthMiddleware } = await import('../../src/middleware/auth.js');
const { HTTP_STATUS, HTTP_HEADERS, HTTP_STATUS_MESSAGES } = await import('../../src/consts/http.js');

import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';

describe('Auth Middleware', () => {
    /** @type {Request} */
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
            expect(authMock.validateAuth).not.toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should call validateAuth and if invalid, call sendUnauthorizedResponse', () => {
            const authError = 'Invalid Auth Token';
            authMock.validateAuth.mockReturnValue({ isValid: false, error: authError });

            middleware(mockReq, mockRes, mockNext);

            expect(mockGetAuthKey).toHaveBeenCalled();
            expect(authMock.validateAuth).toHaveBeenCalledWith(mockReq, MOCK_AUTH_KEY);
            expect(routeUtilsMock.sendUnauthorizedResponse).toHaveBeenCalledWith(mockReq, mockRes, { error: authError });
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should call validateAuth and if valid, call next()', () => {
            authMock.validateAuth.mockReturnValue({ isValid: true });

            middleware(mockReq, mockRes, mockNext);

            expect(mockGetAuthKey).toHaveBeenCalled();
            expect(authMock.validateAuth).toHaveBeenCalledWith(mockReq, MOCK_AUTH_KEY);
            expect(mockNext).toHaveBeenCalled();
            expect(routeUtilsMock.sendUnauthorizedResponse).not.toHaveBeenCalled();
        });
    });
});
