/**
 * @file tests/unit/middleware_json_parser.test.js
 * @description Unit tests for the JSON parsing middleware.
 */

import { jest } from '@jest/globals';
import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

const { createJsonParserMiddleware } = await import('../../src/middleware/json_parser.js');
const { HTTP_HEADERS, MIME_TYPES } = await import('../../src/consts/http.js');

describe('JSON Parser Middleware', () => {
    /** @type {Request & { rawBody?: Buffer | string }} */
    let mockReq;
    /** @type {Response} */
    let mockRes;
    /** @type {NextFunction} */
    let mockNext;
    /** @type {RequestHandler} */
    let middleware;

    beforeEach(() => {
        mockReq = createMockRequest();
        mockRes = createMockResponse();
        mockNext = createMockNextFunction();
        middleware = createJsonParserMiddleware();
        jest.clearAllMocks();
    });

    describe('jsonParserMiddleware', () => {
        it('should call next immediately if req.body is missing', () => {
            mockReq.body = undefined;
            middleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.rawBody).toBeUndefined();
        });

        it('should call next immediately if req.body is not a Buffer', () => {
            mockReq.body = { already: 'parsed' };
            middleware(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.rawBody).toBeUndefined();
            expect(mockReq.body).toEqual({ already: 'parsed' });
        });

        it('should preserve the original Buffer in req.rawBody', () => {
            const bufferBody = Buffer.from('test');
            mockReq.body = bufferBody;

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.rawBody).toBe(bufferBody);
            // Verify defineProperty settings
            const descriptor = Object.getOwnPropertyDescriptor(mockReq, 'rawBody');
            expect(descriptor).toEqual({
                value: bufferBody,
                writable: false,
                enumerable: true,
                configurable: false
            });
        });

        it('should parse valid JSON body when content-type contains application/json', () => {
            const jsonStr = JSON.stringify({ key: 'value' });
            mockReq.body = Buffer.from(jsonStr);
            mockReq.headers[HTTP_HEADERS.CONTENT_TYPE] = `${MIME_TYPES.JSON}; charset=utf-8`;

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.body).toEqual({ key: 'value' });
            expect(mockNext).toHaveBeenCalled();
        });

        it('should fallback to string body if JSON parsing fails and content-type is json', () => {
            const invalidJsonStr = '{"key": "missing quote}';
            mockReq.body = Buffer.from(invalidJsonStr);
            mockReq.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.body).toBe(invalidJsonStr);
            expect(mockNext).toHaveBeenCalled();
        });

        it('should leave body as Buffer if content-type is not JSON', () => {
            const bufferBody = Buffer.from('<xml></xml>');
            mockReq.body = bufferBody;
            mockReq.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.XML;

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.body).toBe(bufferBody);
            expect(mockReq.rawBody).toBe(bufferBody);
            expect(mockNext).toHaveBeenCalled();
        });
    });
});
