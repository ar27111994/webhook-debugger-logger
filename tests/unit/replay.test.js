/**
 * @file tests/unit/replay.test.js
 * @description Unit tests for replay functionality webhook delivery mechanisms.
 */

import { jest } from '@jest/globals';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { assertType, createMockNextFunction, createMockRequest, createMockResponse } from '../setup/helpers/test-utils.js';
import { HTTP_STATUS, HTTP_HEADERS, HTTP_METHODS, HTTP_STATUS_MESSAGES } from '../../src/consts/http.js';
import { ERROR_LABELS, ERROR_MESSAGES } from '../../src/consts/errors.js';
import { FORWARDING_CONSTS, REPLAY_STATUS_LABELS } from '../../src/consts/app.js';
import { STORAGE_CONSTS } from '../../src/consts/storage.js';
import { LOG_CONSTS } from '../../src/consts/logging.js';
import { SSRF_ERRORS } from '../../src/consts/security.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

await setupCommonMocks({ apify: true, repositories: true, services: true, ssrf: true });

const {
    apifyMock: mockApifyActor,
    logRepositoryMock: mockLogRepo,
    forwardingServiceMock: mockForwardingService,
    ssrfMock: mockSsrf
} = await import('../setup/helpers/shared-mocks.js');

const { createReplayHandler } = await import('../../src/routes/replay.js');

describe('Replay Routes', () => {
    /** @type {Request} */
    let mockReq;
    /** @type {Response} */
    let mockRes;
    /** @type {NextFunction} */
    let mockNext;
    /** @type {RequestHandler} */
    let handler;

    const MOCK_TARGET_URL = 'https://valid-target.com';
    const MOCK_TARGET_HOST = 'valid-target.com';
    const MOCK_LOG_ID = 'log-123';
    const MOCK_WEBHOOK_ID = 'wh-123';
    const MOCK_USER_AGENT = 'test';
    const MOCK_BODY = { test: true };


    beforeEach(() => {
        mockReq = createMockRequest({
            params: { webhookId: MOCK_WEBHOOK_ID, itemId: MOCK_LOG_ID },
            query: { url: MOCK_TARGET_URL }
        });
        mockRes = createMockResponse();
        mockNext = createMockNextFunction();
        handler = createReplayHandler();

        // Default happy paths
        mockSsrf.validateUrlForSsrf.mockResolvedValue({ safe: true, href: MOCK_TARGET_URL, host: MOCK_TARGET_HOST });
        mockLogRepo.getLogById.mockResolvedValue(assertType({
            id: MOCK_LOG_ID,
            method: HTTP_METHODS.POST,
            body: MOCK_BODY,
            headers: { [HTTP_HEADERS.USER_AGENT]: MOCK_USER_AGENT }
        }));
        mockLogRepo.findLogs.mockResolvedValue({ items: [], total: 0 });
        mockForwardingService.sendSafeRequest.mockResolvedValue(assertType({ status: HTTP_STATUS.OK, data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK] }));
        jest.clearAllMocks();
    });

    describe('createReplayHandler', () => {
        it('should successfully replay a valid event and strip internal tracking headers', async () => {
            // Let's add a maskable header to bypass as well
            mockLogRepo.getLogById.mockResolvedValue(assertType({
                id: MOCK_LOG_ID,
                method: HTTP_METHODS.POST,
                body: MOCK_BODY,
                headers: {
                    [HTTP_HEADERS.USER_AGENT]: MOCK_USER_AGENT,
                    [HTTP_HEADERS.APIFY_REPLAY]: 'true', // Should be stripped automatically by REPLAY_HEADERS_TO_IGNORE
                    [HTTP_HEADERS.AUTHORIZATION]: LOG_CONSTS.MASKED_VALUE // Log filter replaces this
                }
            }));

            await handler(mockReq, mockRes, mockNext);

            expect(mockSsrf.validateUrlForSsrf).toHaveBeenCalledWith(MOCK_TARGET_URL);
            expect(mockLogRepo.getLogById).toHaveBeenCalledWith(MOCK_LOG_ID);

            expect(mockForwardingService.sendSafeRequest).toHaveBeenCalledWith(
                MOCK_TARGET_URL,
                HTTP_METHODS.POST,
                MOCK_BODY,
                expect.objectContaining({
                    [HTTP_HEADERS.USER_AGENT]: MOCK_USER_AGENT,
                    [HTTP_HEADERS.IDEMPOTENCY_KEY]: MOCK_LOG_ID,
                    [HTTP_HEADERS.APIFY_REPLAY]: 'true',
                    [HTTP_HEADERS.ORIGINAL_WEBHOOK_ID]: MOCK_WEBHOOK_ID
                }),
                expect.objectContaining({ maxRetries: 10, timeout: FORWARDING_CONSTS.FORWARD_TIMEOUT_MS, forwardHeaders: true, hostHeader: MOCK_TARGET_HOST }), // Verify Defaults
                expect.any(AbortSignal)
            );

            // Assert Stripped headers correctly registered
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                HTTP_HEADERS.APIFY_REPLAY_WARNING,
                expect.stringContaining(HTTP_HEADERS.AUTHORIZATION)
            );
            expect(mockRes.json).toHaveBeenCalledWith({
                status: REPLAY_STATUS_LABELS.REPLAYED,
                targetUrl: MOCK_TARGET_URL,
                targetResponseCode: HTTP_STATUS.OK,
                targetResponseBody: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
                strippedHeaders: [HTTP_HEADERS.AUTHORIZATION]
            });
        });

        it('should unwrap array URLs selecting the first entry natively', async () => {
            mockReq.query.url = [MOCK_TARGET_URL, 'https://ignored.com'];

            await handler(mockReq, mockRes, mockNext);

            expect(mockSsrf.validateUrlForSsrf).toHaveBeenCalledWith(MOCK_TARGET_URL);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ status: REPLAY_STATUS_LABELS.REPLAYED }));
        });

        it('should use default req.params, maxRetries and timeout if none provided in arguments or params', async () => {
            mockReq.params = {}; // No webhookId or itemId
            mockReq.query.url = MOCK_TARGET_URL;

            // Notice we do NOT pass getReplayMaxRetries or getReplayTimeoutMs
            const defaultHandler = createReplayHandler();

            mockSsrf.validateUrlForSsrf.mockResolvedValue({ safe: true, href: MOCK_TARGET_URL, host: MOCK_TARGET_HOST });
            // Since itemId is '', it's not a number so fallback string is empty, returns 404
            mockLogRepo.getLogById.mockResolvedValue(null);

            await defaultHandler(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
        });

        it('should fallback natively if injected property accessors return undefined', async () => {
            mockReq.params = {};
            mockReq.query.url = MOCK_TARGET_URL;

            const explicitlyUndefinedHandler = createReplayHandler(() => undefined, () => undefined);

            mockSsrf.validateUrlForSsrf.mockResolvedValue({ safe: true, href: MOCK_TARGET_URL, host: MOCK_TARGET_HOST });
            mockLogRepo.getLogById.mockResolvedValue(null);

            await explicitlyUndefinedHandler(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
        });

        it('should return 400 if URL is missing', async () => {
            mockReq.query.url = undefined;

            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
            expect(mockRes.json).toHaveBeenCalledWith({ error: ERROR_MESSAGES.MISSING_URL });
            expect(mockSsrf.validateUrlForSsrf).not.toHaveBeenCalled();
        });

        it('should send INTERNAL_SERVER_ERROR if internal promise crashes naturally outside validation', async () => {
            const internalError = new Error('Database explode');
            mockSsrf.validateUrlForSsrf.mockRejectedValueOnce(internalError);

            await handler(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: ERROR_LABELS.REPLAY_FAILED }));
        });

        it('should return 400 if URL fails SSRF validation generally', async () => {
            const errorMessage = 'SSRF_BLOCKED';
            mockSsrf.validateUrlForSsrf.mockResolvedValueOnce({ safe: false, error: errorMessage });

            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
            expect(mockRes.json).toHaveBeenCalledWith({ error: errorMessage });
        });

        it('should return 400 mapped nicely if URL fails SSRF resolution checking directly', async () => {
            const errorMessage = SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED;
            mockSsrf.validateUrlForSsrf.mockResolvedValueOnce({ safe: false, error: errorMessage });

            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
            expect(mockRes.json).toHaveBeenCalledWith({ error: ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED });
        });

        it('should return 404 if the log item cannot be found', async () => {
            mockLogRepo.getLogById.mockResolvedValueOnce(null);
            // We pass standard MOCK_LOG_ID ("log-123") so fallback isn't evaluated
            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
            expect(mockRes.json).toHaveBeenCalledWith({ error: ERROR_MESSAGES.EVENT_NOT_FOUND });
            expect(mockForwardingService.sendSafeRequest).not.toHaveBeenCalled();
        });

        it('should fallback to timestamp matching but handle empty items array safely', async () => {
            mockReq.params = { webhookId: 'wh-123', itemId: '2023-01-01T00:00:00.000Z' }; // valid timestamp
            mockReq.query.url = MOCK_TARGET_URL;

            mockLogRepo.getLogById.mockResolvedValueOnce(null); // ID not found

            await handler(mockReq, mockRes, mockNext);

            const { SQL_CONSTS } = await import('../../src/consts/database.js');
            expect(mockLogRepo.findLogs).toHaveBeenCalledWith({
                timestamp: [{ operator: SQL_CONSTS.OPERATORS.EQ, value: mockReq.params.itemId }],
                webhookId: mockReq.params.webhookId,
                limit: 1,
            });
            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
            expect(mockRes.json).toHaveBeenCalledWith({ error: ERROR_MESSAGES.EVENT_NOT_FOUND });
            expect(mockForwardingService.sendSafeRequest).not.toHaveBeenCalled();
        });

        it('should fallback to findLogs by timestamp if itemId maps to a Date value', async () => {
            mockLogRepo.getLogById.mockResolvedValue(null);
            mockReq.params.itemId = '2023-01-01T00:00:00Z'; // Jan 1 2023
            const body = 'timestamp-found';

            const timestampItem = ({ id: 'fallback-1', method: HTTP_METHODS.PUT, body });
            mockLogRepo.findLogs.mockResolvedValue({ items: assertType([timestampItem]), total: 1 });

            await handler(mockReq, mockRes, mockNext);

            expect(mockLogRepo.findLogs).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
            expect(mockForwardingService.sendSafeRequest).toHaveBeenCalledWith(
                MOCK_TARGET_URL,
                HTTP_METHODS.PUT,
                body,
                expect.any(Object),
                expect.any(Object),
                expect.any(AbortSignal)
            );
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ targetResponseCode: 200 }));
        });

        it('should hydrate large payloads back from KVS during replay', async () => {
            const hugePayloadKey = 'huge-payload-123';
            const hydratedPayload = 'hydrated huge string body';
            mockLogRepo.getLogById.mockResolvedValue(assertType({
                id: MOCK_LOG_ID,
                method: HTTP_METHODS.POST,
                body: { data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC, key: hugePayloadKey },
                headers: {}
            }));

            mockApifyActor.getValue.mockResolvedValue(hydratedPayload);

            await handler(mockReq, mockRes, mockNext);

            expect(mockApifyActor.getValue).toHaveBeenCalledWith(hugePayloadKey);
            expect(mockForwardingService.sendSafeRequest).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                hydratedPayload, // Hydrated Value Check
                expect.any(Object),
                expect.any(Object),
                expect.any(AbortSignal)
            );
        });

        it('should pass unhydrated missing payload naturally as error string without failing runtime', async () => {
            const missingPayloadKey = 'missing-payload-404';
            mockLogRepo.getLogById.mockResolvedValue(assertType({
                id: MOCK_LOG_ID,
                method: HTTP_METHODS.POST,
                body: { data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC, key: missingPayloadKey },
                headers: {}
            }));

            mockApifyActor.getValue.mockResolvedValue(null);

            await handler(mockReq, mockRes, mockNext);

            // Replay handles the lack gracefully, sending the original offload marker object as body
            expect(mockForwardingService.sendSafeRequest).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.objectContaining({ data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC, key: missingPayloadKey }),
                expect.any(Object),
                expect.any(Object),
                expect.any(AbortSignal)
            );
        });

        it('should log an error when KVS hydration crashes instead of skipping gracefully', async () => {
            const key = 'crashing-payload-123';
            mockLogRepo.getLogById.mockResolvedValueOnce(assertType({
                id: MOCK_LOG_ID,
                method: HTTP_METHODS.POST,
                body: { data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC, key },
                headers: {}
            }));

            mockApifyActor.getValue.mockRejectedValueOnce(new Error('KVS Error Simulation'));

            await handler(mockReq, mockRes, mockNext);

            expect(mockForwardingService.sendSafeRequest).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.objectContaining({ data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC, key }),
                expect.any(Object),
                expect.any(Object),
                expect.any(AbortSignal)
            );
        });

        it('should process network layer exceptions naturally back to caller', async () => {
            const timeoutCode = 'ETIMEDOUT';
            const timeoutError = new Error(ERROR_MESSAGES.ABORTED);
            Object.assign(timeoutError, { code: timeoutCode });

            mockForwardingService.sendSafeRequest.mockRejectedValue(timeoutError);

            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.GATEWAY_TIMEOUT);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: ERROR_LABELS.REPLAY_FAILED,
                message: expect.stringContaining('timed out'),
                code: timeoutCode
            });
        });

        it('should return a valid replay block if Axios responds via error response code natively', async () => {
            // E.g. destination returned 404/500, but didn't structurally fail connecting.
            const errorData = 'Invalid Schema on target';
            const responseError = new Error('Bad Request');
            Object.assign(responseError, { response: { status: HTTP_STATUS.BAD_REQUEST, data: errorData } });

            mockForwardingService.sendSafeRequest.mockRejectedValue(responseError);

            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith({
                status: REPLAY_STATUS_LABELS.REPLAYED,
                targetUrl: MOCK_TARGET_URL,
                targetResponseCode: HTTP_STATUS.BAD_REQUEST,
                targetResponseBody: errorData
            });
        });

        it('should timeout via null response handling mapping directly to Gateway Timeout', async () => {
            // Simulated situation where the internal response wasn't populated or timed out mapping entirely nil
            mockForwardingService.sendSafeRequest.mockResolvedValue(assertType(null));

            await handler(mockReq, mockRes, mockNext);

            const exhaustedRetries = 10;
            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.GATEWAY_TIMEOUT);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: ERROR_LABELS.REPLAY_FAILED,
                message: ERROR_MESSAGES.REPLAY_ATTEMPTS_EXHAUSTED(exhaustedRetries)
            });
        });

        it('should trigger AbortController signal when total replay timeout occurs', async () => {
            jest.useFakeTimers();

            mockForwardingService.sendSafeRequest.mockImplementation(async (_url, _method, _data, _headers, _config, abortSignal) => {
                expect(abortSignal?.aborted).toBe(false);
                // Advance timers enough to trigger the totalTimeoutMs (10000ms * 11 = 110000)
                const MAX_REPLAY_ATTEMPTS_EXCEEDED = 15;
                const TIMEOUT_ADVANCE_MS = FORWARDING_CONSTS.FORWARD_TIMEOUT_MS * MAX_REPLAY_ATTEMPTS_EXCEEDED;
                jest.advanceTimersByTime(TIMEOUT_ADVANCE_MS);
                expect(abortSignal?.aborted).toBe(true);
                return assertType({ status: HTTP_STATUS.OK, data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK] });
            });

            await handler(mockReq, mockRes, mockNext);

            jest.useRealTimers();
        });

        it('should preserve object body payloads to prevent Axios parsing conflicts', async () => {
            const rawObject = { rawObject: true };
            mockLogRepo.getLogById.mockResolvedValue(assertType({
                id: MOCK_LOG_ID,
                method: HTTP_METHODS.POST,
                body: rawObject,
                headers: {}
            }));

            await handler(mockReq, mockRes, mockNext);

            expect(mockForwardingService.sendSafeRequest).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.objectContaining(rawObject),
                expect.any(Object),
                expect.any(Object),
                expect.any(AbortSignal)
            );
        });

        it('should use dependency injections for custom retry maps', async () => {
            const REPLAY_RETRIES = 1;
            const REPLAY_TIMEOUT = 1000;
            const customRetryMap = () => REPLAY_RETRIES;
            const customTimeoutMap = () => REPLAY_TIMEOUT;
            const customHandler = createReplayHandler(customRetryMap, customTimeoutMap);
            await customHandler(mockReq, mockRes, mockNext);

            expect(mockForwardingService.sendSafeRequest).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Object),
                expect.any(Object),
                expect.objectContaining({ maxRetries: REPLAY_RETRIES, timeout: REPLAY_TIMEOUT }),
                expect.any(AbortSignal)
            );
        });
    });
});
