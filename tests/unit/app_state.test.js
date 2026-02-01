import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  DEFAULT_PAYLOAD_LIMIT,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
} from "../../src/consts.js";

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
} from "../setup/helpers/shared-mocks.js";

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
    });

    test("should use defaults if config values missing", () => {
      const emptyConfig = { urlCount: 0, retentionHours: 0 };
      const emptyState = new AppState(
        emptyConfig,
        webhookManagerMock,
        loggerMiddlewareMock,
      );

      expect(emptyState.maxPayloadSize).toBe(DEFAULT_PAYLOAD_LIMIT);
      expect(emptyState.rateLimiter.limit).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
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
        "Updating max payload size",
      );
    });

    test("should update rate limit", async () => {
      const update = createUpdateConfig({ rateLimitPerMinute: 120 });
      await appState.applyConfigUpdate({}, update);

      expect(appState.rateLimiter.limit).toBe(120);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ rateLimit: 120 }),
        "Updating rate limit",
      );
    });

    test("should update authKey", async () => {
      const update = createUpdateConfig({ authKey: "new-key" });
      await appState.applyConfigUpdate({}, update);

      expect(appState.authKey).toBe("new-key");
      expect(loggerMock.info).toHaveBeenCalledWith("Auth key updated");
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
        "Dynamic scale-up: generating additional webhook(s)",
      );
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
  });

  describe("destroy", () => {
    test("should cleanup rate limiter", () => {
      const destroySpy = jest.spyOn(appState.rateLimiter, "destroy");
      appState.destroy();
      expect(destroySpy).toHaveBeenCalled();
    });
  });
});
