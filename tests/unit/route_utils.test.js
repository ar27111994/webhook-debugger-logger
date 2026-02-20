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

/**
 * @typedef {import('express').Request & { modified?: boolean }} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('http').ServerResponse} ServerResponse
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 */

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
            expect(escapeHtml(assertType(null))).toBe('');
            expect(escapeHtml(assertType(undefined))).toBe('');

            // Edge cases: The !unsafe check makes 0 and false also return empty strings
            expect(escapeHtml(assertType(0))).toBe('');
            expect(escapeHtml(assertType(false))).toBe('');
        });

        it('should handle unusual prototypes or numbers seamlessly if cast to string prior', () => {
            const unsafe = String(0);
            expect(escapeHtml(unsafe)).toBe('0');
        });
    });

    describe('asyncHandler', () => {
        it('should resolve synchronous functions correctly', async () => {
            /** @type {Request} */
            const mockReq = createMockRequest();
            const mockRes = createMockResponse();
            const mockNext = createMockNextFunction();

            /**
             * @param {Request} req
             */
            const syncFn = (req) => {
                req.modified = true;
            };

            const wrappedFn = asyncHandler(assertType(syncFn));
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(mockReq.modified).toBe(true);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should resolve asynchronous functions correctly', async () => {
            /** @type {Request} */
            const mockReq = createMockRequest();
            const mockRes = createMockResponse();
            const mockNext = createMockNextFunction();

            /** 
             * @param {Request} req
             */
            const asyncFn = async (req) => {
                const ASYNC_DELAY_MS = 10;
                return new Promise((resolve) => setTimeout(() => {
                    req.modified = true;
                    resolve(undefined);
                }, ASYNC_DELAY_MS));
            };

            const wrappedFn = asyncHandler(asyncFn);
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(mockReq.modified).toBe(true);
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

            const wrappedFn = asyncHandler(syncFn);
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

            const wrappedFn = asyncHandler(asyncFn);
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
        });

        it('should catch non-Error rejections (like strings or plain objects)', async () => {
            const mockReq = createMockRequest();
            const mockRes = createMockResponse();
            const mockNext = createMockNextFunction();
            const stringRejection = 'Something went wrong';

            const asyncFn = async () => {
                throw stringRejection;
            };

            const wrappedFn = asyncHandler(asyncFn);
            await wrappedFn(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(stringRejection);
        });
    });

    describe('createBroadcaster', () => {
        beforeEach(() => {
            loggerMock.error.mockClear();
        });

        it('should broadcast serialized data to all connected clients', () => {
            const client1 = { write: jest.fn() };
            const client2 = { write: jest.fn() };
            /** @type {Set<ServerResponse>} */
            const clients = assertType(new Set([client1, client2]));
            const data = { hello: 'world' };

            const broadcast = createBroadcaster(clients);
            broadcast(data);

            const expectedMessage = `${SSE_CONSTS.DATA_PREFIX}${JSON.stringify(data)}\n\n`;
            expect(client1.write).toHaveBeenCalledWith(expectedMessage);
            expect(client2.write).toHaveBeenCalledWith(expectedMessage);
        });

        it('should handle client write failures, remove client, log error extracting code/name properties', async () => {
            const { createChildLogger } = await import('../../src/utils/logger.js');
            const mockLogger = createChildLogger({ component: 'RouteUtilsTest' });

            /** @type {ServerResponse} */
            const client1 = assertType({ write: jest.fn() });

            const errorMsg = 'Connection reset by peer';
            const errorCode = 'ECONNRESET';
            const errorName = 'SystemError';

            /** @type {CommonError} */
            const customError = new Error(errorMsg);
            customError.code = errorCode;
            customError.name = errorName;

            /** @type {ServerResponse} */
            const client2 = assertType({
                write: jest.fn().mockImplementation(() => {
                    throw customError;
                })
            });
            /** @type {Set<ServerResponse>} */
            const clients = new Set([client1, client2]);
            const data = { ping: 'pong' };

            const broadcast = createBroadcaster(clients);
            broadcast(data);

            const expectedMessage = `${SSE_CONSTS.DATA_PREFIX}${JSON.stringify(data)}\n\n`;
            expect(client1.write).toHaveBeenCalledWith(expectedMessage);
            expect(client2.write).toHaveBeenCalledWith(expectedMessage);

            // Client 2 should be removed
            expect(clients.has(client1)).toBe(true);
            expect(clients.has(client2)).toBe(false);

            // Verify error was logged containing extracted properties
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.objectContaining({
                        message: errorMsg,
                        code: errorCode,
                        name: errorName
                    })
                }),
                expect.any(String)
            );
        });

        it('should handle client write failures when errors lack a code', async () => {
            const { createChildLogger } = await import('../../src/utils/logger.js');
            const mockLogger = createChildLogger({ component: 'RouteUtilsTest' });

            /** @type {ServerResponse} */
            const client = assertType({
                write: jest.fn().mockImplementation(() => {
                    throw new Error('Generic failure');
                })
            });
            /** @type {Set<ServerResponse>} */
            const clients = new Set([client]);

            const broadcast = createBroadcaster(clients);
            broadcast({ ping: 'pong' });

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.objectContaining({
                        message: 'Generic failure',
                        code: APP_CONSTS.UNKNOWN,
                        name: 'Error'
                    })
                }),
                expect.any(String)
            );
        });

        it('should handle high concurrency of client broadcasting without maxing the stack', () => {
            /** @type {Set<ServerResponse>} */
            const clients = new Set();
            const CLIENT_COUNT = 10000;

            for (let i = 0; i < CLIENT_COUNT; i++) {
                clients.add(assertType({ write: jest.fn() }));
            }

            const broadcast = createBroadcaster(clients);

            expect(() => {
                broadcast({ test: 'stress' });
            }).not.toThrow();

            // Just test the first and last to ensure the loop ran smoothly
            const clientsArr = Array.from(clients);
            expect(clientsArr[0].write).toHaveBeenCalled();
            expect(clientsArr[CLIENT_COUNT - 1].write).toHaveBeenCalled();
        });

        it('should abort broadcasting if data serialization fails', () => {
            /** @type {ServerResponse} */
            const client = assertType({ write: jest.fn() });
            const clients = new Set([client]);
            const broadcast = createBroadcaster(clients);

            const circularData = { self: assertType(undefined) };
            circularData.self = circularData; // Create circular reference

            expect(() => {
                broadcast(circularData);
            }).toThrow(TypeError);

            expect(client.write).not.toHaveBeenCalled();
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

        it('should throw an error on circular references', () => {
            const circularObject = { prop: null };
            // @ts-expect-error - creating intentional cycle for testing
            circularObject.prop = circularObject;

            // `jsonSafe` relies on JSON.stringify directly, so it will throw immediately
            expect(() => jsonSafe(circularObject)).toThrow(TypeError);
        });
    });

    describe('sendUnauthorizedResponse', () => {
        /** @type {Request} */
        let mockReq;
        /** @type {Response} */
        let mockRes;

        beforeEach(() => {
            mockReq = createMockRequest();
            mockRes = createMockResponse();
            jest.clearAllMocks();
        });

        it('should return JSON by default or when Accept header implies it', () => {
            const webhookId = 'webhook-123';
            const errorMsg = 'Missing token';
            const options = { id: webhookId, error: errorMsg };
            sendUnauthorizedResponse(mockReq, mockRes, options);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: HTTP_STATUS.UNAUTHORIZED,
                error: ERROR_LABELS.UNAUTHORIZED,
                id: webhookId,
                docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
                message: errorMsg,
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

            const htmlOutput = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(htmlOutput).toContain(APP_CONSTS.APIFY_HOMEPAGE_URL);

            // Should be escaped!
            expect(htmlOutput).toContain(escapeHtml(htmlErrorMsg));
            expect(htmlOutput).not.toContain('<script>');
        });
    });
});
