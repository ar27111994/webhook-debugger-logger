/**
 * @file tests/unit/utils/app_state.test.js
 * @description Unit tests for the AppState class.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../../setup/helpers/test-lifecycle.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createMockRequest, createMockResponse, createMockNextFunction, assertType } from "../../setup/helpers/test-utils.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("body-parser").Options} Options
 * @typedef {import("../../../src/typedefs.js").WebhookConfig} WebhookConfig
 */

// Mock body-parser
jest.unstable_mockModule("body-parser", () => ({
    default: {
        /**
         * @param {Options} _options
         * @returns {RequestHandler}
         */
        raw: jest.fn((_options) =>
            /**
             * @param {Request} _req
             * @param {Response} _res
             * @param {NextFunction} next
             */
            (_req, _res, next) => next())
    }
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
const RATE_LIMITER_PATH = join(__dirname, "../../../src/utils/rate_limiter.js");

// Mock RateLimiter
jest.unstable_mockModule(RATE_LIMITER_PATH, () => ({
    RateLimiter: class {
        limit;
        constructor(limit = 0) { this.limit = limit; }
        middleware() {
            /**
             * @param {Request} _req
             * @param {Response} _res
             * @param {NextFunction} next
             */
            return (_req, _res, next) => next();
        }
        destroy() { }
    }
}));

await setupCommonMocks({
    logger: true,
    consts: true,
    webhookManager: true,
    loggerMiddleware: true
});

const { loggerMock, webhookManagerMock, loggerMiddlewareMock } = await import("../../setup/helpers/shared-mocks.js");
const { AppState } = await import("../../../src/utils/app_state.js");
const { APP_CONSTS } = await import("../../../src/consts/app.js");
const { LOG_MESSAGES } = await import("../../../src/consts/messages.js");
const { default: bodyParser } = await import("body-parser");

describe("AppState", () => {
    useMockCleanup();

    const DEFAULT_TEST_URL_COUNT = 1;
    const DEFAULT_TEST_RETENTION = 24;
    const DEFAULT_TEST_PAYLOAD_LIMIT = 1024;
    const DEFAULT_TEST_RATE_LIMIT = 60;
    const DEFAULT_TEST_RETRIES = 3;
    const DEFAULT_TEST_TIMEOUT = 30000;
    const DEFAULT_TEST_MEMORY = 256;

    /** @type {any} */
    let mockConfig;
    /** @type {InstanceType<typeof AppState>} */
    let appState;

    beforeEach(() => {
        mockConfig = {
            authKey: "old-key",
            maxPayloadSize: DEFAULT_TEST_PAYLOAD_LIMIT,
            retentionHours: DEFAULT_TEST_RETENTION,
            urlCount: DEFAULT_TEST_URL_COUNT,
            rateLimitPerMinute: DEFAULT_TEST_RATE_LIMIT,
            replayMaxRetries: DEFAULT_TEST_RETRIES,
            replayTimeoutMs: DEFAULT_TEST_TIMEOUT,
            useFixedMemory: false,
            fixedMemoryMbytes: DEFAULT_TEST_MEMORY
        };

        // Align getAllActive to urlCount to prevent Scale Up during constructor if any logic calls it
        jest.mocked(webhookManagerMock.getAllActive).mockReturnValue(new Array(mockConfig.urlCount).fill({}));

        appState = new AppState(mockConfig, webhookManagerMock, loggerMiddlewareMock);

        // Reset mocks after constructor calls
        jest.clearAllMocks();
        jest.mocked(webhookManagerMock.getAllActive).mockReturnValue(new Array(mockConfig.urlCount).fill({}));
    });

    describe("constructor", () => {
        it("should initialize with provided config", () => {
            expect(appState.authKey).toBe("old-key");
            expect(appState.maxPayloadSize).toBe(DEFAULT_TEST_PAYLOAD_LIMIT);
            expect(appState.retentionHours).toBe(DEFAULT_TEST_RETENTION);
            expect(appState.urlCount).toBe(DEFAULT_TEST_URL_COUNT);
        });

        it("should use default values for missing config properties", () => {
            const emptyState = new AppState({}, webhookManagerMock, loggerMiddlewareMock);
            expect(emptyState.maxPayloadSize).toBe(APP_CONSTS.DEFAULT_PAYLOAD_LIMIT);
            expect(emptyState.replayMaxRetries).toBe(APP_CONSTS.DEFAULT_REPLAY_RETRIES);
            expect(emptyState.authKey).toBe("");
        });
    });

    describe("middleware accessors", () => {
        it("should provide bodyParserMiddleware", () => {
            const middleware = appState.bodyParserMiddleware;
            expect(typeof middleware).toBe("function");

            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNextFunction();
            middleware(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it("should provide rateLimitMiddleware", () => {
            const middleware = appState.rateLimitMiddleware;
            expect(typeof middleware).toBe("function");
        });
    });

    describe("applyConfigUpdate()", () => {
        it("should propagate updates to loggerMiddleware", async () => {
            /** @type {WebhookConfig} */
            const newNormalizedInput = assertType({ some: "input" });
            const validated = { ...mockConfig };
            await appState.applyConfigUpdate(newNormalizedInput, validated);
            expect(loggerMiddlewareMock.updateOptions).toHaveBeenCalledWith(newNormalizedInput);
        });

        it("should update maxPayloadSize and recreate bodyParser", async () => {
            const NEW_LIMIT = 2048;
            const validated = { ...mockConfig, maxPayloadSize: NEW_LIMIT };
            await appState.applyConfigUpdate({}, validated);

            expect(appState.maxPayloadSize).toBe(NEW_LIMIT);
            expect(bodyParser.raw).toHaveBeenCalledWith(expect.objectContaining({ limit: NEW_LIMIT }));
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ maxPayloadSize: NEW_LIMIT }),
                LOG_MESSAGES.UPDATE_MAX_PAYLOAD
            );
        });

        it("should update rate limiter limit", async () => {
            const NEW_RATE = 120;
            const validated = { ...mockConfig, rateLimitPerMinute: NEW_RATE };
            await appState.applyConfigUpdate({}, validated);

            expect(appState.rateLimiter.limit).toBe(NEW_RATE);
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ rateLimit: NEW_RATE }),
                LOG_MESSAGES.UPDATE_RATE_LIMIT
            );
        });

        it("should update auth key", async () => {
            const validated = { ...mockConfig, authKey: "new-key" };
            await appState.applyConfigUpdate({}, validated);

            expect(appState.authKey).toBe("new-key");
            expect(loggerMock.info).toHaveBeenCalledWith(LOG_MESSAGES.AUTH_KEY_UPDATED);
        });

        it("should scale up webhooks if urlCount increases", async () => {
            const NEW_COUNT = 3;
            jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]); // 0 active
            const validated = { ...mockConfig, urlCount: NEW_COUNT };
            await appState.applyConfigUpdate({}, validated);

            expect(appState.urlCount).toBe(NEW_COUNT);
            expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(NEW_COUNT, DEFAULT_TEST_RETENTION);
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ count: NEW_COUNT }),
                LOG_MESSAGES.DYNAMIC_SCALE_UP
            );
        });

        it("should use default retention hours during scale up if current is falsy", async () => {
            appState.retentionHours = 0;
            const NEW_COUNT = 2;
            jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
            const validated = { ...mockConfig, urlCount: NEW_COUNT };
            await appState.applyConfigUpdate({}, validated);

            expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(
                NEW_COUNT - 0,
                APP_CONSTS.DEFAULT_RETENTION_HOURS
            );
        });

        it("should update retention settings", async () => {
            const NEW_RETENTION = 48;
            const validated = { ...mockConfig, retentionHours: NEW_RETENTION };
            await appState.applyConfigUpdate({}, validated);

            expect(appState.retentionHours).toBe(NEW_RETENTION);
            expect(webhookManagerMock.updateRetention).toHaveBeenCalledWith(NEW_RETENTION);
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ retentionHours: NEW_RETENTION }),
                LOG_MESSAGES.UPDATE_RETENTION
            );
        });

        it("should update replay settings", async () => {
            const NEW_RETRIES = 5;
            const NEW_TIMEOUT = 60000;
            const validated = {
                ...mockConfig,
                replayMaxRetries: NEW_RETRIES,
                replayTimeoutMs: NEW_TIMEOUT
            };
            await appState.applyConfigUpdate({}, validated);

            expect(appState.replayMaxRetries).toBe(NEW_RETRIES);
            expect(appState.replayTimeoutMs).toBe(NEW_TIMEOUT);
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ replayMaxRetries: NEW_RETRIES }),
                LOG_MESSAGES.UPDATE_REPLAY_RETRIES
            );
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ replayTimeoutMs: NEW_TIMEOUT }),
                LOG_MESSAGES.UPDATE_REPLAY_TIMEOUT
            );
        });

        it("should update memory management settings", async () => {
            const NEW_MEM = 512;
            const validated = {
                ...mockConfig,
                useFixedMemory: true,
                fixedMemoryMbytes: NEW_MEM
            };
            await appState.applyConfigUpdate({}, validated);

            expect(appState.useFixedMemory).toBe(true);
            expect(appState.fixedMemoryMbytes).toBe(NEW_MEM);
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ useFixedMemory: true }),
                LOG_MESSAGES.UPDATE_FIXED_MEMORY
            );
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ fixedMemoryMbytes: NEW_MEM }),
                LOG_MESSAGES.UPDATE_MANUAL_MEMORY
            );
        });

        it("should do nothing if values have not changed", async () => {
            const validated = { ...mockConfig };
            // Ensure getAllActive matches urlCount to skip scale up
            jest.mocked(webhookManagerMock.getAllActive).mockReturnValue(new Array(mockConfig.urlCount).fill({}));

            await appState.applyConfigUpdate({}, validated);

            expect(loggerMock.info).not.toHaveBeenCalled();
            expect(webhookManagerMock.generateWebhooks).not.toHaveBeenCalled();
        });
    });

    describe("destroy()", () => {
        it("should cleanup rate limiter if present", () => {
            const destroySpy = jest.spyOn(appState.rateLimiter, "destroy");
            appState.destroy();
            expect(destroySpy).toHaveBeenCalled();
        });

        it("should handle missing rate limiter during destroy", () => {
            // @ts-expect-error - Deleting mandatory property for test coverage
            delete appState.rateLimiter;
            expect(() => appState.destroy()).not.toThrow();
        });
    });
});
