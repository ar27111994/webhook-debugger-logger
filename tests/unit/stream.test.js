/**
 * @file tests/unit/stream.test.js
 * @description Unit tests for the SSE log stream route handler.
 */

import { jest } from '@jest/globals';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { assertType, createMockNextFunction, createMockRequest, createMockResponse } from '../setup/helpers/test-utils.js';
import {
    HTTP_STATUS,
    MIME_TYPES,
    HTTP_HEADERS,
    HTTP_STATUS_MESSAGES,
} from '../../src/consts/http.js';
import { SSE_CONSTS } from '../../src/consts/ui.js';
import { SECURITY_HEADERS_VALUES } from '../../src/consts/security.js';
import { ERROR_MESSAGES } from '../../src/consts/errors.js';
import { loggerMock } from '../setup/helpers/shared-mocks.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('http').ServerResponse} ServerResponse
 */

await setupCommonMocks({ logger: true });
await jest.resetModules();

const { createLogStreamHandler } = await import('../../src/routes/stream.js');

describe('Stream Route', () => {
    /** @type {Request} */
    let mockReq;
    /** @type {Response} */
    let mockRes;
    /** @type {NextFunction} */
    let mockNext;
    /** @type {Set<ServerResponse>} */
    let clients;

    beforeEach(() => {
        mockReq = createMockRequest({
            on: assertType(jest.fn())
        });
        mockRes = createMockResponse({
            flushHeaders: jest.fn(),
            write: assertType(jest.fn())
        });
        mockNext = createMockNextFunction();
        clients = new Set();
        jest.clearAllMocks();
        loggerMock.error.mockClear();
    });

    it('should establish an SSE connection successfully', () => {
        const handler = createLogStreamHandler(clients);
        handler(mockReq, mockRes, mockNext);

        // Headers check
        expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.CONTENT_ENCODING, SECURITY_HEADERS_VALUES.IDENTITY);
        expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.EVENT_STREAM);
        expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.CACHE_CONTROL, SECURITY_HEADERS_VALUES.NO_CACHE);
        expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.CONNECTION, SECURITY_HEADERS_VALUES.KEEP_ALIVE);
        expect(mockRes.setHeader).toHaveBeenCalledWith(HTTP_HEADERS.X_ACCEL_BUFFERING, SECURITY_HEADERS_VALUES.NO);

        // API check
        expect(mockRes.flushHeaders).toHaveBeenCalled();
        expect(mockRes.write).toHaveBeenCalledWith(SSE_CONSTS.CONNECTED_MESSAGE);

        // Padded write to bypass proxies
        const secondWrite = jest.mocked(mockRes.write).mock.calls[1][0];
        expect(secondWrite).toContain(': ');
        expect(secondWrite).toContain('\n\n');

        // Client set check
        expect(clients.size).toBe(1);
        expect(clients.has(mockRes)).toBe(true);

        // Disconnect listener check
        expect(mockReq.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should reject connections when maxSseClients limit is reached', () => {
        const maxSseClients = 2;
        clients.add(assertType({ id: 1 }));
        clients.add(assertType({ id: 2 }));

        const handler = createLogStreamHandler(clients, { maxSseClients });
        handler(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.SERVICE_UNAVAILABLE);
        expect(mockRes.json).toHaveBeenCalledWith({
            error: HTTP_STATUS_MESSAGES[HTTP_STATUS.SERVICE_UNAVAILABLE],
            message: ERROR_MESSAGES.SSE_LIMIT_REACHED(maxSseClients)
        });

        // Ensure headers and writes logic was bypassed
        expect(mockRes.setHeader).not.toHaveBeenCalled();
        expect(mockRes.write).not.toHaveBeenCalled();
        expect(clients.size).toBe(maxSseClients);
    });

    it('should cleanup client if the request is closed', () => {
        // Setup successful connection first
        const handler = createLogStreamHandler(clients);
        handler(mockReq, mockRes, mockNext);

        expect(clients.size).toBe(1);

        // Simulate closed request
        const closeHandler = jest.mocked(mockReq.on).mock.calls.find(c => c[0] === 'close')?.[1];
        expect(closeHandler).toBeDefined();

        if (closeHandler) {
            closeHandler();
        }

        expect(clients.size).toBe(0);
        expect(clients.has(mockRes)).toBe(false);
    });

    it('should log an error if res.write throws during connection establishment', async () => {
        const writeError = new Error('Write failed');
        mockRes.write = assertType(jest.fn()).mockImplementation(() => {
            throw writeError;
        });

        const handler = createLogStreamHandler(clients);

        // Wrap to catch potential synchronous throws, shouldn't throw to Express though
        expect(() => {
            handler(mockReq, mockRes, mockNext);
        }).not.toThrow();

        // The error mock logger uses createChildLogger so we verify the actual
        // loggerMock reference was used via the mock-setup mapping
        expect(loggerMock.error).toHaveBeenCalled();
        expect(clients.size).toBe(0); // Cannot be added if write throws
    });
});
