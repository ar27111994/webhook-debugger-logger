/**
 * @file tests/unit/route_utils.test.js
 * @description Unit tests for shared route utilities.
 */

import { jest } from '@jest/globals';
import { APP_CONSTS } from '../../src/consts/app.js';
import { HTTP_STATUS, HTTP_HEADERS, MIME_TYPES } from '../../src/consts/http.js';
import { ERROR_LABELS } from '../../src/consts/errors.js';
import { SSE_CONSTS } from '../../src/consts/ui.js';

import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { loggerMock } from '../setup/helpers/shared-mocks.js';
import { assertType, createMockRequest, createMockResponse, createMockNextFunction } from '../setup/helpers/test-utils.js';

await setupCommonMocks({ logger: true });
await jest.resetModules();

const {
    escapeHtml,
    asyncHandler,
    createBroadcaster,
    jsonSafe,
    sendUnauthorizedResponse,
} = await import('../../src/routes/utils.js');

describe('Route Utils', () => {
    describe('escapeHtml', () => {
        it('should escape dangerous characters to prevent XSS', () => {
            const unsafe = '<script>alert("xss" & \'xss\')</script>';
            const safe = escapeHtml(unsafe);
            expect(safe).toBe('&lt;script&gt;alert(&quot;xss&quot; &amp; &#039;xss&#039;)&lt;/script&gt;');
        });

        it('should return an empty string for falsy values', () => {
            expect(escapeHtml('')).toBe('');
            expect(escapeHtml(/** @type {any} */(null))).toBe('');
            expect(escapeHtml(/** @type {any} */(undefined))).toBe('');
        });
    });

    describe('asyncHandler', () => {
        it('should resolve synchronous functions correctly', async () => {
            const mockReq = createMockRequest();
            const mockRes = createMockResponse();
            const mockNext = createMockNextFunction();

            const syncFn = (/** @type {any} */ req) => {
                req.modified = true;
            };

            const wrappedFn = asyncHandler(assertType(syncFn));
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(/** @type {any} */(mockReq).modified).toBe(true);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should resolve asynchronous functions correctly', async () => {
            const mockReq = createMockRequest();
            const mockRes = createMockResponse();
            const mockNext = createMockNextFunction();

            const asyncFn = async (/** @type {any} */ req) => {
                const ASYNC_DELAY_MS = 10;
                return new Promise(/** @type {any} */(resolve) => setTimeout(() => {
                    /** @type {any} */ (req).modified = true;
                    resolve(undefined);
                }, ASYNC_DELAY_MS));
            };

            const wrappedFn = asyncHandler(/** @type {any} */(asyncFn));
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(/** @type {any} */(mockReq).modified).toBe(true);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should catch synchronous errors and pass them to next', async () => {
            const mockReq = createMockRequest();
            const mockRes = createMockResponse();
            const mockNext = createMockNextFunction();
            const testError = new Error('Sync error');

            const syncFn = () => {
                throw testError;
            };

            const wrappedFn = asyncHandler(/** @type {any} */(syncFn));
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
        });

        it('should catch asynchronous errors and pass them to next', async () => {
            const mockReq = createMockRequest();
            const mockRes = createMockResponse();
            const mockNext = createMockNextFunction();
            const testError = new Error('Async error');

            const asyncFn = async () => {
                throw testError;
            };

            const wrappedFn = asyncHandler(/** @type {any} */(asyncFn));
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
        });
    });

    describe('createBroadcaster', () => {
        beforeEach(() => {
            loggerMock.error.mockClear();
        });

        it('should broadcast serialized data to all connected clients', () => {
            const client1 = { write: jest.fn() };
            const client2 = { write: jest.fn() };
            const clients = /** @type {any} */ (new Set([client1, client2]));
            const data = { hello: 'world' };

            const broadcast = createBroadcaster(clients);
            broadcast(data);

            const expectedMessage = `${SSE_CONSTS.DATA_PREFIX}${JSON.stringify(data)}\n\n`;
            expect(client1.write).toHaveBeenCalledWith(expectedMessage);
            expect(client2.write).toHaveBeenCalledWith(expectedMessage);
        });

        it('should handle client write failures, remove client, and log error', async () => {
            const { createChildLogger } = await import('../../src/utils/logger.js');
            const mockLogger = createChildLogger({ component: 'RouteUtilsTest' });

            const client1 = { write: jest.fn() };
            const client2 = {
                write: jest.fn().mockImplementation(() => {
                    throw new Error('EPIPE Broken pipe');
                })
            };
            const clients = /** @type {any} */ (new Set([client1, client2]));
            const data = { ping: 'pong' };

            const broadcast = createBroadcaster(clients);
            broadcast(data);

            const expectedMessage = `${SSE_CONSTS.DATA_PREFIX}${JSON.stringify(data)}\n\n`;
            expect(client1.write).toHaveBeenCalledWith(expectedMessage);
            expect(client2.write).toHaveBeenCalledWith(expectedMessage);

            // Client 2 should be removed
            expect(clients.has(client1)).toBe(true);
            expect(clients.has(client2)).toBe(false);

            // Verify error was logged (we check that the mock was called)
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('jsonSafe', () => {
        it('should serialize deep objects successfully', () => {
            const input = { a: 1, b: { c: 2 } };
            const output = jsonSafe(input);
            expect(output).toEqual(input);
            expect(output).not.toBe(input); // Should be a deep copy
        });

        it('should convert BigInt values to Numbers', () => {
            const input = { id: 123n, nested: { value: 456n } };
            const output = jsonSafe(input);
            expect(output).toEqual({ id: 123, nested: { value: 456 } });
        });

        it('should handle undefined values gracefully (by dropping them as JSON does)', () => {
            const input = { keep: true, drop: undefined };
            const output = jsonSafe(input);
            expect(output).toEqual({ keep: true });
        });
    });

    describe('sendUnauthorizedResponse', () => {
        /** @type {import('express').Request} */
        let mockReq;
        /** @type {import('express').Response} */
        let mockRes;

        beforeEach(() => {
            mockReq = createMockRequest();
            mockRes = createMockResponse();
            jest.clearAllMocks();
        });

        it('should return JSON by default or when Accept header implies it', () => {
            const options = { id: 'webhook-123', error: 'Missing token' };
            sendUnauthorizedResponse(mockReq, mockRes, options);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.UNAUTHORIZED,
                error: ERROR_LABELS.UNAUTHORIZED,
                id: 'webhook-123',
                docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
                message: 'Missing token',
            });
            expect(mockRes.send).not.toHaveBeenCalled();
        });

        it('should fall back to defaults when options are omitting', () => {
            sendUnauthorizedResponse(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.UNAUTHORIZED,
                error: ERROR_LABELS.UNAUTHORIZED,
                id: undefined,
                docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
                message: ERROR_LABELS.UNAUTHORIZED,
            });
        });

        it('should return rendered HTML template if Accept header includes text/html', () => {
            mockReq.headers[HTTP_HEADERS.ACCEPT] = `${MIME_TYPES.HTML},application/xhtml+xml`;
            const htmlErrorMsg = '<script>alert()</script>';
            const options = { error: htmlErrorMsg };

            sendUnauthorizedResponse(mockReq, mockRes, options);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
            expect(mockRes.send).toHaveBeenCalled();
            expect(mockRes.json).not.toHaveBeenCalled();

            const htmlOutput = /** @type {jest.Mock} */ (mockRes.send).mock.calls[0][0];
            expect(htmlOutput).toContain(APP_CONSTS.APIFY_HOMEPAGE_URL);

            // Should be escaped!
            expect(htmlOutput).toContain(escapeHtml(htmlErrorMsg));
            expect(htmlOutput).not.toContain('<script>');
        });
    });
});
