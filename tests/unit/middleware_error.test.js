/**
 * @file tests/unit/middleware_error.test.js
 * @description Unit tests for the error handling middleware.
 */

import { jest } from '@jest/globals';

/**
 * @typedef {import('../../src/typedefs.js').CustomRequest} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').ErrorRequestHandler} ErrorRequestHandler
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 */

import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
await setupCommonMocks({ logger: true });

const { loggerMock } = await import('../setup/helpers/shared-mocks.js');

const { createErrorHandler } = await import('../../src/middleware/error.js');
const { HTTP_STATUS, HTTP_STATUS_MESSAGES } = await import('../../src/consts/http.js');
const { ERROR_LABELS } = await import('../../src/consts/errors.js');
const { LOG_MESSAGES } = await import('../../src/consts/messages.js');
const { APP_CONSTS } = await import('../../src/consts/app.js');

import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';
import { HTTP_METHODS } from '../../src/consts/http.js';

describe('Error Handling Middleware', () => {
    /** @type {Request} */
    let mockReq;
    /** @type {Response} */
    let mockRes;
    /** @type {NextFunction} */
    let mockNext;
    /** @type {ErrorRequestHandler} */
    let middleware;

    const REQUEST_ID = 'req-123';

    beforeEach(() => {
        mockReq = createMockRequest();
        Object.assign(mockReq, {
            path: '/api/test',
            method: HTTP_METHODS.POST,
            requestId: REQUEST_ID
        });

        mockRes = createMockResponse();
        mockNext = createMockNextFunction();

        middleware = createErrorHandler();

        jest.clearAllMocks();
    });

    describe('createErrorHandler', () => {
        it('should pass error to next() if headers are already sent', () => {
            mockRes.headersSent = true;
            /** @type {Error} */
            const err = new Error('Some error');

            middleware(err, mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(err);
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(loggerMock.error).not.toHaveBeenCalled();
        });

        it('should extract status from err.statusCode and handle 400 error safely without logging', () => {
            const errorMsg = 'Bad Input';
            /** @type {CommonError} */
            const err = new Error(errorMsg);
            err.statusCode = HTTP_STATUS.BAD_REQUEST;

            middleware(err, mockReq, mockRes, mockNext);

            // Response evaluation
            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.BAD_REQUEST,
                requestId: REQUEST_ID,
                error: HTTP_STATUS_MESSAGES[HTTP_STATUS.BAD_REQUEST],
                message: errorMsg
            });

            // No 500-level logging
            expect(loggerMock.error).not.toHaveBeenCalled();
        });

        it('should extract status from err.status and sanitize internal server errors (500) and log them', () => {
            const errorMsg = 'Database cluster failure';
            /** @type {CommonError} */
            const err = new Error(errorMsg);
            err.status = HTTP_STATUS.SERVICE_UNAVAILABLE;

            middleware(err, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.SERVICE_UNAVAILABLE);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                requestId: REQUEST_ID,
                error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
                message: ERROR_LABELS.INTERNAL_SERVER_ERROR // Message is masked
            });

            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: REQUEST_ID,
                    status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                    path: '/api/test',
                    method: HTTP_METHODS.POST,
                    err: expect.objectContaining({ message: errorMsg })
                }),
                LOG_MESSAGES.SERVER_ERROR
            );
        });

        it('should fallback to 500 Default status and extract fallback unknown if requestId is missing', () => {
            /** @type {CommonError} */
            const err = new Error('Unknown catastrophic event');
            delete mockReq.requestId; // No request id provided

            middleware(err, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
                requestId: APP_CONSTS.UNKNOWN,
                error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
                message: ERROR_LABELS.INTERNAL_SERVER_ERROR
            });

            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: APP_CONSTS.UNKNOWN,
                    status: HTTP_STATUS.INTERNAL_SERVER_ERROR
                }),
                LOG_MESSAGES.SERVER_ERROR
            );
        });

        it('should use ERROR_LABELS.GENERIC if HTTP_STATUS_MESSAGES lacks the status message', () => {
            const errorMsg = 'Weird code';
            /** @type {CommonError} */
            const err = new Error(errorMsg);
            err.status = 495; // Assume not mapped in HTTP_STATUS_MESSAGES

            middleware(err, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith({
                status: err.status,
                requestId: REQUEST_ID,
                error: ERROR_LABELS.GENERIC,
                message: errorMsg
            });
        });
    });
});
