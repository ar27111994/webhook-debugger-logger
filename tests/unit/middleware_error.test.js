/**
 * @file tests/unit/middleware_error.test.js
 * @description Unit tests for the error handling middleware.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
    createChildLogger: jest.fn().mockReturnValue({
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn()
    }),
    serializeError: jest.fn().mockImplementation((err) => ({ message: err.message }))
}));

const { createErrorHandler } = await import('../../src/middleware/error.js');
const { createChildLogger, serializeError } = await import('../../src/utils/logger.js');
const { HTTP_STATUS, HTTP_STATUS_MESSAGES } = await import('../../src/consts/http.js');
const { ERROR_LABELS } = await import('../../src/consts/errors.js');
const { LOG_MESSAGES } = await import('../../src/consts/messages.js');
const { APP_CONSTS } = await import('../../src/consts/app.js');

import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';

describe('Error Handling Middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;
    let middleware;
    let mockLogger;

    beforeEach(() => {
        mockReq = createMockRequest();
        mockReq.path = '/api/test';
        mockReq.method = 'POST';
        mockReq.requestId = 'req-123';

        mockRes = createMockResponse();
        mockNext = createMockNextFunction();

        middleware = createErrorHandler();
        mockLogger = createChildLogger();

        jest.clearAllMocks();
    });

    describe('createErrorHandler', () => {
        it('should pass error to next() if headers are already sent', () => {
            mockRes.headersSent = true;
            const err = new Error('Some error');

            middleware(err, mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(err);
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        it('should extract status from err.statusCode and handle 400 error safely without logging', () => {
            const err = new Error('Bad Input');
            err.statusCode = HTTP_STATUS.BAD_REQUEST;

            middleware(err, mockReq, mockRes, mockNext);

            // Response evaluation
            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.BAD_REQUEST,
                requestId: 'req-123',
                error: HTTP_STATUS_MESSAGES[HTTP_STATUS.BAD_REQUEST],
                message: 'Bad Input'
            });

            // No 500-level logging
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        it('should extract status from err.status and sanitize internal server errors (500) and log them', () => {
            const err = new Error('Database cluster failure');
            err.status = HTTP_STATUS.SERVICE_UNAVAILABLE;

            middleware(err, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.SERVICE_UNAVAILABLE);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                requestId: 'req-123',
                error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
                message: ERROR_LABELS.INTERNAL_SERVER_ERROR // Message is masked
            });

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'req-123',
                    status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                    path: '/api/test',
                    method: 'POST',
                    err: { message: 'Database cluster failure' }
                }),
                LOG_MESSAGES.SERVER_ERROR
            );
        });

        it('should fallback to 500 Default status and extract fallback unknown if requestId is missing', () => {
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

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: APP_CONSTS.UNKNOWN,
                    status: HTTP_STATUS.INTERNAL_SERVER_ERROR
                }),
                LOG_MESSAGES.SERVER_ERROR
            );
        });

        it('should use ERROR_LABELS.GENERIC if HTTP_STATUS_MESSAGES lacks the status message', () => {
            const err = new Error('Weird code');
            err.status = 495; // Assume not mapped in HTTP_STATUS_MESSAGES

            middleware(err, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith({
                status: 495,
                requestId: 'req-123',
                error: ERROR_LABELS.GENERIC,
                message: 'Weird code'
            });
        });
    });
});
