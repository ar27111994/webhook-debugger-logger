/**
 * @file tests/unit/dashboard.test.js
 * @description Unit tests for the dashboard route handler.
 */

import { jest } from '@jest/globals';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import {
    assertType,
    createMockNextFunction,
    createMockRequest,
    createMockResponse,
} from '../setup/helpers/test-utils.js';
import { HTTP_STATUS, MIME_TYPES, HTTP_HEADERS, HTTP_STATUS_MESSAGES } from '../../src/consts/http.js';
import { DASHBOARD_CONSTS, DASHBOARD_PLACEHOLDERS, STATUS_LABELS } from '../../src/consts/ui.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('../../src/routes/dashboard.js').DashboardDependencies} DashboardDependencies
 */

await setupCommonMocks({ logger: true, fs: true });
await jest.resetModules();

const { readFile } = await import('fs/promises');
const { createDashboardHandler, preloadTemplate } = await import('../../src/routes/dashboard.js');
const { createChildLogger } = await import('../../src/utils/logger.js');
const { escapeHtml } = await import('../../src/routes/utils.js');

describe('Dashboard Route', () => {
    const mockLogger = createChildLogger({ component: 'Test' });

    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(mockLogger.warn).mockClear();
        jest.mocked(mockLogger.error).mockClear();
    });

    describe('preloadTemplate', () => {
        it('should return file content on successful read', async () => {
            const expectedTemplate = '<html>Dashboard</html>';
            jest.mocked(readFile).mockResolvedValueOnce(expectedTemplate);

            const result = await preloadTemplate();
            expect(result).toBe(expectedTemplate);
            expect(readFile).toHaveBeenCalledTimes(1);
        });

        it('should log warning and return empty string on read failure', async () => {
            const error = new Error('ENOENT: no such file');
            jest.mocked(readFile).mockRejectedValueOnce(error);

            const result = await preloadTemplate();

            expect(result).toBe('');
            expect(readFile).toHaveBeenCalledTimes(1);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.any(Object) }),
                expect.any(String)
            );
        });
    });

    describe('createDashboardHandler', () => {
        /** @type {DashboardDependencies & { webhookManager: { getAllActive: jest.Mock } }} */
        let deps;
        /** @type {Request} */
        let mockReq;
        /** @type {Response} */
        let mockRes;
        /** @type {NextFunction} */
        let mockNext;

        /** @type {string | null} */
        let templateCache = null;

        const version = '3.1.3';

        beforeEach(() => {
            templateCache = null;
            deps = ({
                webhookManager: assertType({
                    getAllActive: jest.fn().mockReturnValue([{}, {}]) // length 2
                }),
                version,
                getTemplate: jest.fn(() => templateCache),
                setTemplate: jest.fn(
                    /** @param {string} t */
                    (t) => { templateCache = t; }),
                getSignatureStatus: assertType(jest.fn()).mockReturnValue('GitHub')
            });

            mockReq = createMockRequest();
            mockRes = createMockResponse();
            mockNext = createMockNextFunction();
        });

        it('should respond with plain text statistics when Accept header prefers text/plain', async () => {
            mockReq.headers[HTTP_HEADERS.ACCEPT] = MIME_TYPES.PLAIN;

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.type).toHaveBeenCalledWith(MIME_TYPES.PLAIN);
            // Verify content matches expected basic metrics
            const responseText = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(responseText).toContain(DASHBOARD_CONSTS.BRAND_HEADER);
            expect(responseText).toContain(version);
            expect(responseText).toContain('Active Webhooks: 2');
            expect(responseText).toContain('Signature Verification: GitHub');
        });

        it('should handle undefined getSignatureStatus in text mode gracefully', async () => {
            mockReq.headers[HTTP_HEADERS.ACCEPT] = MIME_TYPES.PLAIN;
            deps.getSignatureStatus = assertType(undefined);
            deps.webhookManager.getAllActive.mockReturnValueOnce([]);

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            const responseText = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(responseText).toContain('Active Webhooks: 0');
            expect(responseText).toContain(`Signature Verification: ${STATUS_LABELS.DISABLED}`);
        });

        it('should serve HTML template from cache if available', async () => {
            const rawTemplate = `${DASHBOARD_PLACEHOLDERS.VERSION}|${DASHBOARD_PLACEHOLDERS.ACTIVE_COUNT}|${DASHBOARD_PLACEHOLDERS.SIGNATURE_BADGE}|${DASHBOARD_PLACEHOLDERS.BRAND_HEADER}`;
            templateCache = rawTemplate;
            jest.mocked(deps.getTemplate).mockReturnValueOnce(rawTemplate);

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            expect(readFile).not.toHaveBeenCalled();
            expect(deps.getTemplate).toHaveBeenCalled();

            const htmlOutput = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(htmlOutput).toContain(version);
            expect(htmlOutput).toContain('2');
            expect(htmlOutput).toContain('🔒 Verified: GitHub');
            expect(htmlOutput).toContain(DASHBOARD_CONSTS.BRAND_HEADER);
        });

        it('should load template from file system, cache it, and serve HTML', async () => {
            const rawTemplate = `Testing Template ${DASHBOARD_PLACEHOLDERS.VERSION}`;
            jest.mocked(readFile).mockResolvedValueOnce(rawTemplate);

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            expect(deps.getTemplate).toHaveBeenCalled();
            expect(deps.setTemplate).toHaveBeenCalledWith(rawTemplate);
            expect(readFile).toHaveBeenCalledTimes(1);

            const htmlOutput = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(htmlOutput).toContain(`Testing Template v${version}`);
        });

        it('should escape malicious signature provider names to prevent XSS', async () => {
            templateCache = `${DASHBOARD_PLACEHOLDERS.SIGNATURE_BADGE}`;
            const unsafeProvider = '<script>alert("XSS")</script>';
            jest.mocked(deps.getSignatureStatus).mockReturnValueOnce(unsafeProvider);

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            const htmlOutput = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(htmlOutput).not.toContain('<script>');
            expect(htmlOutput).toContain(escapeHtml(unsafeProvider));
        });

        it('should escape malicious version string to prevent XSS', async () => {
            templateCache = `${DASHBOARD_PLACEHOLDERS.VERSION}`;
            deps.version = '<script>alert("VERSION XSS")</script>';

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            const htmlOutput = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(htmlOutput).not.toContain('<script>');
            expect(htmlOutput).toContain(escapeHtml(deps.version));
        });

        it('should serve HTML if Accept header is missing', async () => {
            templateCache = "HTML Response";
            delete mockReq.headers[HTTP_HEADERS.ACCEPT];

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            expect(mockRes.send).toHaveBeenCalledWith(templateCache);
        });

        it('should not re-read from disk if template is an empty string', async () => {
            templateCache = ''; // Empty string representing missing file but loaded check

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            expect(readFile).not.toHaveBeenCalled();
            expect(deps.getTemplate).toHaveBeenCalled();

            const htmlOutput = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(htmlOutput).toBe(''); // Emptiness preserved
        });

        it('should prevent cache stampede by reusing the same file read promise', async () => {
            templateCache = null;

            // Mock a delayed file read
            /** @type {(value: string) => void} */
            let resolveRead = () => { };
            const readPromise = new Promise(resolve => {
                resolveRead = resolve;
            });
            jest.mocked(readFile).mockReturnValueOnce(readPromise);

            const handler = createDashboardHandler(deps);

            // Execute 3 concurrent requests
            const req1 = handler(mockReq, mockRes, mockNext);
            const req2 = handler(mockReq, mockRes, mockNext);
            const req3 = handler(mockReq, mockRes, mockNext);

            // Should only call readFile once immediately despite 3 calls
            expect(readFile).toHaveBeenCalledTimes(1);

            // Resolve promise manually
            const templateValue = `Shared Template ${DASHBOARD_PLACEHOLDERS.VERSION}`;
            resolveRead(templateValue);

            await Promise.all([req1, req2, req3]);

            // Ensure we only set the cache string down once
            expect(deps.setTemplate).toHaveBeenCalledTimes(1);
            expect(deps.setTemplate).toHaveBeenCalledWith(templateValue);
        });

        it('should display inactive signature badge if no signature provider is registered', async () => {
            templateCache = `${DASHBOARD_PLACEHOLDERS.SIGNATURE_BADGE}`;
            jest.mocked(deps.getSignatureStatus).mockReturnValueOnce(null);

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            const htmlOutput = jest.mocked(mockRes.send).mock.calls[0][0];
            expect(htmlOutput).toContain(`🔓 ${STATUS_LABELS.NO_VERIFICATION}`);
            expect(htmlOutput).not.toContain('🔒 Verified:');
        });

        it('should log error and return 500 when template loading fails entirely', async () => {
            jest.mocked(readFile).mockRejectedValueOnce(new Error('Permission denied'));

            const handler = createDashboardHandler(deps);
            await handler(mockReq, mockRes, mockNext);

            // Responds with 500
            expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR);
            expect(mockRes.send).toHaveBeenCalledWith(HTTP_STATUS_MESSAGES[HTTP_STATUS.INTERNAL_SERVER_ERROR] || expect.any(String));

            // Should have logged an error
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.any(Object) }),
                expect.any(String)
            );
        });
    });
});
