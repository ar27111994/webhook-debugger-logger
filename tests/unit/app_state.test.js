import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType } from "../setup/helpers/test-utils.js";

// 1. Setup Common Mocks
await setupCommonMocks({
  logger: true,
  webhookManager: true,
  loggerMiddleware: true,
});

// Import module under test
const { AppState } = await import("../../src/utils/app_state.js");

import {
  webhookManagerMock,
  loggerMiddlewareMock,
  loggerMock,
  constsMock,
} from "../setup/helpers/shared-mocks.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";

/**
 * @typedef {import("../../src/utils/app_state.js").AppState} AppState
 */

describe("AppState", () => {
  useMockCleanup();

  /** @type {AppState} */
  let appState;

  beforeEach(() => {
    // Create fresh mocks for each test

    // Default config
    const config = {
      authKey: "test-auth-key",
      maxPayloadSize: 1024,
      retentionHours: 24,
      urlCount: 1,
      rateLimitPerMinute: 60,
      useFixedMemory: true,
      fixedMemoryMbytes: 4096,
    };

    appState = new AppState(config, webhookManagerMock, loggerMiddlewareMock);
  });

  // Helper to create full config for updates
  const createUpdateConfig = (overrides = {}) => ({
    authKey: "test-auth-key",
    maxPayloadSize: 1024,
    retentionHours: 24,
    urlCount: 1,
    rateLimitPerMinute: 60,
    replayMaxRetries: 3,
    replayTimeoutMs: 1000,
    responseDelayMs: 0,
    maxForwardRetries: 3,
    useFixedMemory: true,
    fixedMemoryMbytes: 4096,
    ...overrides,
  });

  describe("Initialization", () => {
    test("should initialize with provided config", () => {
      expect(appState.authKey).toBe("test-auth-key");
      expect(appState.maxPayloadSize).toBe(1024);
      expect(appState.retentionHours).toBe(24);
      expect(appState.urlCount).toBe(1);
      // Rate limiter initialization check
      expect(appState.rateLimiter).toBeDefined();
      expect(appState.rateLimiter.limit).toBe(60);
      expect(appState.useFixedMemory).toBe(true);
      expect(appState.fixedMemoryMbytes).toBe(4096);
    });

    test("should use defaults if config values missing", () => {
      const emptyConfig = { urlCount: 0, retentionHours: 0 };
      const emptyState = new AppState(
        emptyConfig,
        webhookManagerMock,
        loggerMiddlewareMock,
      );

      expect(emptyState.maxPayloadSize).toBe(constsMock.DEFAULT_PAYLOAD_LIMIT);
      expect(emptyState.rateLimiter.limit).toBe(
        constsMock.DEFAULT_RATE_LIMIT_PER_MINUTE,
      );
      expect(emptyState.useFixedMemory).toBe(false);
      expect(emptyState.fixedMemoryMbytes).toBe(
        constsMock.DEFAULT_FIXED_MEMORY_MBYTES,
      );
    });
  });

  describe("Middleware Getters", () => {
    test("should return bodyParser middleware", () => {
      expect(typeof appState.bodyParserMiddleware).toBe("function");
    });

    test("should return rateLimit middleware", () => {
      expect(typeof appState.rateLimitMiddleware).toBe("function");
    });
  });

  describe("applyConfigUpdate", () => {
    test("should update maxPayloadSize and recreate body parser", async () => {
      const update = createUpdateConfig({ maxPayloadSize: 2048 });
      await appState.applyConfigUpdate({}, update);

      expect(appState.maxPayloadSize).toBe(2048);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ maxPayloadSize: 2048 }),
        LOG_MESSAGES.UPDATE_MAX_PAYLOAD,
      );
    });

    test("should update rate limit", async () => {
      const update = createUpdateConfig({ rateLimitPerMinute: 120 });
      await appState.applyConfigUpdate({}, update);

      expect(appState.rateLimiter.limit).toBe(120);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ rateLimit: 120 }),
        LOG_MESSAGES.UPDATE_RATE_LIMIT,
      );
    });

    test("should update authKey", async () => {
      const update = createUpdateConfig({ authKey: "new-key" });
      await appState.applyConfigUpdate({}, update);

      expect(appState.authKey).toBe("new-key");
      expect(loggerMock.info).toHaveBeenCalledWith(
        LOG_MESSAGES.AUTH_KEY_UPDATED,
      );
    });

    test("should trigger webhook generation if urlCount increases", async () => {
      // Mock current active webhooks as 1
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue([
          { id: "wh_1", expiresAt: "2026-01-01T00:00:00.000Z" },
        ]);

      const update = createUpdateConfig({ urlCount: 3, retentionHours: 24 });

      await appState.applyConfigUpdate({}, update);

      expect(appState.urlCount).toBe(3);
      // Should generate 2 new ones (3 - 1)
      expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(2, 24);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 2 }),
        LOG_MESSAGES.DYNAMIC_SCALE_UP,
      );
    });

    test("should use default retention (24h) if retentionHours is missing", async () => {
      appState.retentionHours = assertType(undefined);
      jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
      const update = createUpdateConfig({
        urlCount: 1,
        retentionHours: undefined,
      });

      await appState.applyConfigUpdate({}, update);

      expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(1, 24);
    });

    test("should NOT trigger generation if urlCount is sufficient", async () => {
      jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([
        { id: "wh_1", expiresAt: "2026-01-01T00:00:00.000Z" },
        { id: "wh_2", expiresAt: "2026-01-01T00:00:00.000Z" },
      ]);
      const update = createUpdateConfig({ urlCount: 2 });

      await appState.applyConfigUpdate({}, update);

      expect(webhookManagerMock.generateWebhooks).not.toHaveBeenCalled();
    });

    test("should propagate updates to loggerMiddleware", async () => {
      const rawInput = { extra: "data" };
      await appState.applyConfigUpdate(rawInput, createUpdateConfig());

      expect(loggerMiddlewareMock.updateOptions).toHaveBeenCalledWith(rawInput);
    });

    test("should update retention hours and notify webhook manager", async () => {
      const update = createUpdateConfig({ retentionHours: 48 });
      await appState.applyConfigUpdate({}, update);

      expect(appState.retentionHours).toBe(48);
      expect(webhookManagerMock.updateRetention).toHaveBeenCalledWith(48);
    });

    test("should update replay max retries", async () => {
      const update = createUpdateConfig({ replayMaxRetries: 5 });
      await appState.applyConfigUpdate({}, update);

      expect(appState.replayMaxRetries).toBe(5);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ replayMaxRetries: 5 }),
        LOG_MESSAGES.UPDATE_REPLAY_RETRIES,
      );
    });

    test("should update replay timeout", async () => {
      const update = createUpdateConfig({ replayTimeoutMs: 5000 });
      await appState.applyConfigUpdate({}, update);

      expect(appState.replayTimeoutMs).toBe(5000);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ replayTimeoutMs: 5000 }),
        LOG_MESSAGES.UPDATE_REPLAY_TIMEOUT,
      );
    });

    test("should update useFixedMemory", async () => {
      appState.useFixedMemory = false;
      const update = createUpdateConfig({ useFixedMemory: true });
      await appState.applyConfigUpdate({}, update);

      expect(appState.useFixedMemory).toBe(true);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ useFixedMemory: true }),
        LOG_MESSAGES.UPDATE_FIXED_MEMORY,
      );
    });

    test("should update fixedMemoryMbytes", async () => {
      appState.fixedMemoryMbytes = constsMock.DEFAULT_FIXED_MEMORY_MBYTES;
      const update = createUpdateConfig({ fixedMemoryMbytes: 8192 });
      await appState.applyConfigUpdate({}, update);

      expect(appState.fixedMemoryMbytes).toBe(8192);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ fixedMemoryMbytes: 8192 }),
        LOG_MESSAGES.UPDATE_MANUAL_MEMORY,
      );
    });
  });

  describe("destroy", () => {
    test("should cleanup rate limiter", () => {
      const destroySpy = jest.spyOn(appState.rateLimiter, "destroy");
      appState.destroy();
      expect(destroySpy).toHaveBeenCalled();
    });

    test("should handle destroy when rate limiter is missing", () => {
      appState.rateLimiter = assertType(null);
      expect(() => appState.destroy()).not.toThrow();
    });
  });
});
