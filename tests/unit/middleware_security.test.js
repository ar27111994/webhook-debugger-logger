/**
 * @file tests/unit/middleware_security.test.js
 * @description Unit tests for the security middleware including Request ID and CSP headers.
 */

import { jest } from '@jest/globals';
import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';

// Mock specific utility validation behavior explicitly (optional, but good for precise control)
jest.unstable_mockModule('../../src/utils/common.js', () => ({
    validateUUID: jest.fn()
}));

const { validateUUID } = await import('../../src/utils/common.js');
const { createRequestIdMiddleware, createCspMiddleware } = await import('../../src/middleware/security.js');
const { REQUEST_ID_PREFIX } = await import('../../src/consts/app.js');
const { HTTP_HEADERS, MIME_TYPES } = await import('../../src/consts/http.js');
const { SECURITY_CONSTS, SECURITY_HEADERS_VALUES } = await import('../../src/consts/security.js');

describe('Security Middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = createMockRequest();
        mockReq.headers = {}; // clear explicitly
        mockRes = createMockResponse();
        mockNext = createMockNextFunction();
        jest.clearAllMocks();
    });

    describe('createRequestIdMiddleware', () => {
        let middleware;
        beforeEach(() => {
            middleware = createRequestIdMiddleware();
            // Default UUID validator behavior
            jest.mocked(validateUUID).mockReturnValue(false);
        });

        it('should generate a new request ID if none is provided', () => {
            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBeDefined();
            expect(mockReq.requestId.startsWith(REQUEST_ID_PREFIX)).toBe(true);
            expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_REQUEST_ID, mockReq.requestId);
            expect(mockNext).toHaveBeenCalled();
        });

        it('should generate a new request ID if the provided string is an invalid UUID', () => {
            mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = 'invalid-id';
            jest.mocked(validateUUID).mockReturnValue(false);

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).not.toBe('invalid-id');
            expect(mockReq.requestId.startsWith(REQUEST_ID_PREFIX)).toBe(true);
            expect(validateUUID).toHaveBeenCalledWith('invalid-id');
        });

        it('should extract from lowercase header and use it if valid UUID', () => {
            const validUUID = '123e4567-e89b-12d3-a456-426614174000';
            mockReq.headers[HTTP_HEADERS.X_REQUEST_ID.toLowerCase()] = validUUID;
            jest.mocked(validateUUID).mockReturnValue(true);

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBe(validUUID);
            expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_REQUEST_ID, validUUID);
            expect(validateUUID).toHaveBeenCalledWith(validUUID);
        });

        it('should extract from array header string safely if valid', () => {
            const validUUID = '123e4567-e89b-12d3-a456-426614174001';
            mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = [validUUID, 'second-val'];
            jest.mocked(validateUUID).mockReturnValue(true);

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBe(validUUID);
        });

        it('should strip prefix before validating a provided ID that contains the prefix', () => {
            const uuidWithoutPrefix = '123e4567-e89b-12d3-a456-426614174002';
            mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = `${REQUEST_ID_PREFIX}${uuidWithoutPrefix}`;
            jest.mocked(validateUUID).mockReturnValue(true);

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBe(`${REQUEST_ID_PREFIX}${uuidWithoutPrefix}`);
            expect(validateUUID).toHaveBeenCalledWith(uuidWithoutPrefix);
        });

        it('should handle an empty string provided in the headers cleanly', () => {
            mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = '';

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBeDefined();
            expect(mockReq.requestId.startsWith(REQUEST_ID_PREFIX)).toBe(true);
        });

        it('should handle an empty array provided in the headers cleanly', () => {
            mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = [];

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.requestId).toBeDefined();
            expect(mockReq.requestId.startsWith(REQUEST_ID_PREFIX)).toBe(true);
        });
    });

    describe('createCspMiddleware', () => {
        let middleware;
        beforeEach(() => {
            middleware = createCspMiddleware();
        });

        it('should apply universal security headers immediately', () => {
            middleware(mockReq, mockRes, mockNext);

            expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_CONTENT_TYPE_OPTIONS, SECURITY_HEADERS_VALUES.NOSNIFF);
            expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_FRAME_OPTIONS, SECURITY_HEADERS_VALUES.DENY);
            expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.REFERRER_POLICY, SECURITY_HEADERS_VALUES.REF_STRICT_ORIGIN);
            expect(mockRes.setHeader).toHaveBeenCalledWith(SECURITY_HEADERS_VALUES.HSTS_HEADER, SECURITY_HEADERS_VALUES.HSTS_VALUE);
            expect(mockRes.setHeader).toHaveBeenCalledWith(SECURITY_HEADERS_VALUES.PERMISSIONS_POLICY_HEADER, SECURITY_HEADERS_VALUES.PERMISSIONS_POLICY_VALUE);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should mock writeHead and not apply CSP if content type is missing', () => {
            middleware(mockReq, mockRes, mockNext);

            // Mock getHeader behavior
            mockRes.getHeader.mockReturnValue(undefined);

            // Trigger writeHead wrap
            mockRes.writeHead(200);

            expect(mockRes.setHeader).not.toHaveBeenCalledWith(HTTP_HEADERS.CONTENT_SECURITY_POLICY, expect.anything());
        });

        it('should not apply CSP if content type is not HTML', () => {
            middleware(mockReq, mockRes, mockNext);

            mockRes.getHeader.mockReturnValue(MIME_TYPES.JSON);
            mockRes.writeHead(200, { some: 'header' }, 'reason');

            expect(mockRes.setHeader).not.toHaveBeenCalledWith(HTTP_HEADERS.CONTENT_SECURITY_POLICY, expect.anything());
        });

        it('should apply CSP if content type is HTML', () => {
            middleware(mockReq, mockRes, mockNext);

            mockRes.getHeader.mockReturnValue(`${MIME_TYPES.HTML}; charset=utf-8`);
            mockRes.writeHead(200);

            expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.CONTENT_SECURITY_POLICY, SECURITY_CONSTS.CSP_POLICY);
            // Verify original writeHead was called
            // In our mock setup, writeHead is a jest.fn(). The mockRes.writeHead gets replaced.
            // But we know it succeeded because it didn't crash.
        });

        it('should not double-wrap writeHead if middleware is called twice on the same response object', () => {
            // Note: The WeakSet tracks objects directly.
            middleware(mockReq, mockRes, mockNext);
            const wrappedWriteHead1 = mockRes.writeHead;

            middleware(mockReq, mockRes, mockNext);
            const wrappedWriteHead2 = mockRes.writeHead;

            // If it didn't double-wrap, the function reference should be identical
            expect(wrappedWriteHead1).toBe(wrappedWriteHead2);
        });
    });
});
