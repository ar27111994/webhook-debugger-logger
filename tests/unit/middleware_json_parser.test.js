/**
 * @file tests/unit/middleware_json_parser.test.js
 * @description Unit tests for the JSON parsing middleware.
 */

import { jest } from '@jest/globals';
import { createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';
import { ENCODINGS } from '../../src/consts/http.js';

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
            const jsonObject = { key: 'value' };
            const jsonStr = JSON.stringify(jsonObject);
            mockReq.body = Buffer.from(jsonStr);
            mockReq.headers[HTTP_HEADERS.CONTENT_TYPE] = `${MIME_TYPES.JSON}; charset=${ENCODINGS.UTF8}`;

            middleware(mockReq, mockRes, mockNext);

            expect(mockReq.body).toEqual(jsonObject);
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

        it('should parse valid JSON array structures gracefully without causing structural damage', () => {
            const jsonArray = [{ id: 1 }, { id: 2 }];
            const jsonStr = JSON.stringify(jsonArray);
            mockReq.body = Buffer.from(jsonStr);
            mockReq.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;

            middleware(mockReq, mockRes, mockNext);

            expect(Array.isArray(mockReq.body)).toBe(true);
            expect(mockReq.body).toEqual(jsonArray);
            expect(mockNext).toHaveBeenCalled();
        });

        it('should safely parse an extremely large and nested JSON without crashing (Simulation of upstream limit dependency)', () => {
            // Create a deeply nested object to test parse performance limits (Do NOT do true DoS in unit tests though!)
            const deepJson = { highly: { nested: { payload: { with: { lots: { of: { data: 'value' } } } } } } };
            const MASSIVE_ARRAY_SIZE = 5000;
            const massiveJson = Array(MASSIVE_ARRAY_SIZE).fill(deepJson);
            const jsonStr = JSON.stringify(massiveJson);

            mockReq.body = Buffer.from(jsonStr);
            mockReq.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;

            // This confirms we can safely process the string before upstream body-parser drops it
            expect(() => middleware(mockReq, mockRes, mockNext)).not.toThrow();

            expect(Array.isArray(mockReq.body)).toBe(true);
            expect(mockReq.body.length).toBe(MASSIVE_ARRAY_SIZE);
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
