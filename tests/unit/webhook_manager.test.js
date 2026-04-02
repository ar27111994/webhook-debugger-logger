/**
 * @file tests/unit/webhook_manager.test.js
 * @description Unit tests for WebhookManager logic.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  useMockCleanup,
  useFakeTimers,
} from "../setup/helpers/test-lifecycle.js";
import { assertType } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 */

// Setup common mocks BEFORE importing source files
await setupCommonMocks({
  apify: true,
  logger: true,
  db: true,
  repositories: true,
  consts: true,
});

const { apifyMock, logRepositoryMock, loggerMock, constsMock, duckDbMock } =
  await import("../setup/helpers/shared-mocks.js");
const keyValueStoreMock = await apifyMock.openKeyValueStore();
const { WebhookManager } = await import("../../src/webhook_manager.js");
const { APP_CONSTS, WEBHOOK_ID_PREFIX, ENV_VARS, ENV_VALUES } =
  await import("../../src/consts/app.js");
const { KVS_KEYS } = await import("../../src/consts/storage.js");
const { ERROR_MESSAGES } = await import("../../src/consts/errors.js");
const { LOG_MESSAGES } = await import("../../src/consts/messages.js");
const ONE_HOUR_MS = constsMock.APP_CONSTS.MS_PER_HOUR;
const TEST_RETENTION = constsMock.APP_CONSTS.DEFAULT_RETENTION_HOURS;
const INVALID_RETENTION_NEG = -5;
const INVALID_ZERO = 0;
const INVALID_COUNT_NEG = -1;
const INVALID_COUNT_FLOAT = 0.5;

describe("WebhookManager", () => {
  useMockCleanup();
  useFakeTimers();

  /** @type {WebhookManager} */
  let manager;

  beforeEach(() => {
    manager = new WebhookManager();
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z").getTime());

    // Ensure test mode is active for addWebhookForTest
    process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

    // Default KeyValueStore Mock Responses
    apifyMock.openKeyValueStore.mockResolvedValue(keyValueStoreMock);
    keyValueStoreMock.getValue.mockResolvedValue(null);
    keyValueStoreMock.setValue.mockResolvedValue(undefined);
  });

  describe("Initialization", () => {
    it("should initialize and restore state from KeyValueStore", async () => {
      const futureDate = new Date(Date.now() + ONE_HOUR_MS).toISOString();
      const mockState = {
        wh_123: { expiresAt: futureDate },
      };
      keyValueStoreMock.getValue.mockResolvedValue(mockState);

      await manager.init();

      // Opens the default Key-Value Store (parameterless)
      expect(apifyMock.openKeyValueStore).toHaveBeenCalled();
      expect(keyValueStoreMock.getValue).toHaveBeenCalledWith(KVS_KEYS.STATE);
      expect(manager.webhookCount).toBe(1);
      expect(loggerMock.info).toHaveBeenCalledWith(
        { count: 1 },
        LOG_MESSAGES.WEBHOOK_STATE_RESTORED,
      );
    });

    it("should handle missing state gracefully", async () => {
      keyValueStoreMock.getValue.mockResolvedValue(null);

      await manager.init();

      expect(manager.webhookCount).toBe(0);
    });

    it("should handle KVS error during init without crashing", async () => {
      keyValueStoreMock.getValue.mockRejectedValue(new Error("KVS Error"));

      await manager.init();

      expect(manager.webhookCount).toBe(0);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.WEBHOOK_STATE_INIT_FAILED,
      );
    });

    it("should unconditionally overwrite in-memory state on double init() from a populated KVS state", async () => {
      // First, populate memory
      const initialCount = 3;
      await manager.generateWebhooks(initialCount, TEST_RETENTION);
      expect(manager.webhookCount).toBe(initialCount);

      // Now set a distinct state into KVS mocked return
      const staleKVSState = {
        wh_stale: {
          expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        },
      };
      keyValueStoreMock.getValue.mockResolvedValueOnce(staleKVSState);

      // Trigger second initialization
      await manager.init();

      // Memory must be overwritten entirely (length = 1)
      expect(manager.webhookCount).toBe(1);
      expect(manager.isValid("wh_stale")).toBe(true);
    });
  });

  describe("generateWebhooks", () => {
    it("should generate requested number of webhooks", async () => {
      const count = 3;
      const retention = TEST_RETENTION;

      const ids = await manager.generateWebhooks(count, retention);

      expect(ids.length).toBe(count);
      expect(manager.webhookCount).toBe(count);
      expect(ids[0].startsWith(WEBHOOK_ID_PREFIX)).toBe(true);

      // Checks if it persisted to KVS
      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith(
        KVS_KEYS.STATE,
        expect.objectContaining({
          [ids[0]]: expect.objectContaining({
            expiresAt: expect.any(String),
          }),
        }),
      );
    });

    it("should allow generating 0 webhooks and just persist current state", async () => {
      const ids = await manager.generateWebhooks(0, TEST_RETENTION);
      expect(ids).toEqual([]);
      expect(manager.webhookCount).toBe(0);
      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith(
        KVS_KEYS.STATE,
        expect.any(Object),
      );
    });

    it("should fail if count is negative or invalid", async () => {
      await expect(
        manager.generateWebhooks(INVALID_COUNT_NEG, TEST_RETENTION),
      ).rejects.toThrow(ERROR_MESSAGES.INVALID_COUNT(INVALID_COUNT_NEG));
      await expect(
        manager.generateWebhooks(INVALID_COUNT_FLOAT, TEST_RETENTION),
      ).rejects.toThrow(ERROR_MESSAGES.INVALID_COUNT(INVALID_COUNT_FLOAT));
    });

    it("should fail if count exceeds max bulk create", async () => {
      const tooMany = APP_CONSTS.MAX_BULK_CREATE + 1;
      await expect(
        manager.generateWebhooks(tooMany, TEST_RETENTION),
      ).rejects.toThrow(
        ERROR_MESSAGES.INVALID_COUNT_MAX(tooMany, APP_CONSTS.MAX_BULK_CREATE),
      );
    });

    it("should fail if retention is invalid", async () => {
      await expect(
        manager.generateWebhooks(1, INVALID_RETENTION_NEG),
      ).rejects.toThrow(
        ERROR_MESSAGES.INVALID_RETENTION(INVALID_RETENTION_NEG),
      );
      await expect(
        // @ts-expect-error - Testing invalid input
        manager.generateWebhooks(1, String(TEST_RETENTION)),
      ).rejects.toThrow(
        // @ts-expect-error - Testing invalid input
        ERROR_MESSAGES.INVALID_RETENTION(String(TEST_RETENTION)),
      );
      await expect(manager.generateWebhooks(1, Infinity)).rejects.toThrow(
        ERROR_MESSAGES.INVALID_RETENTION(Infinity),
      );
    });

    it("should log error if persist fails", async () => {
      keyValueStoreMock.setValue.mockRejectedValueOnce(
        new Error("Persist error"),
      );
      await manager.generateWebhooks(1, TEST_RETENTION);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.WEBHOOK_STATE_PERSIST_FAILED,
      );
    });
  });

  describe("isValid / getAllActive", () => {
    it("should accurately report validity based on expiration", async () => {
      const previousEnv = process.env[ENV_VARS.NODE_ENV];

      try {
        process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

        manager.addWebhookForTest("wh_active", {
          expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        });
        manager.addWebhookForTest("wh_expired", {
          expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
        });
        manager.addWebhookForTest("wh_invalid", { expiresAt: "invalid-date" });
        manager.addWebhookForTest("wh_boundary", {
          expiresAt: new Date(Date.now()).toISOString(),
        });

        expect(manager.isValid("wh_active")).toBe(true);
        expect(manager.isValid("wh_expired")).toBe(false);
        expect(manager.isValid("wh_boundary")).toBe(false); // Invalid exactly at expiry
        expect(manager.isValid("wh_invalid")).toBe(false); // Invalid dates evaluate to NaN, now < NaN is false
        expect(manager.isValid("non_existent")).toBe(false);
      } finally {
        process.env[ENV_VARS.NODE_ENV] = previousEnv;
      }
    });

    it("should list all active webhooks accurately", async () => {
      const previousEnv = process.env[ENV_VARS.NODE_ENV];

      try {
        process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

        manager.addWebhookForTest("wh_active", {
          expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        });
        manager.addWebhookForTest("wh_active2", {
          expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        });
        manager.addWebhookForTest("wh_expired", {
          expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
        });

        const active = manager.getAllActive();
        const EXPECTED_COUNT = 2;
        expect(active.length).toBe(EXPECTED_COUNT);
        expect(active.map((w) => w.id)).toEqual(["wh_active", "wh_active2"]);
      } finally {
        process.env[ENV_VARS.NODE_ENV] = previousEnv;
      }
    });
  });

  describe("cleanup", () => {
    beforeEach(() => {
      const previousEnv = process.env[ENV_VARS.NODE_ENV];

      try {
        process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

        manager.addWebhookForTest("wh_expired", {
          expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
        });
        manager.addWebhookForTest("wh_active", {
          expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        });

        // Provide log repo mock
        logRepositoryMock.findOffloadedPayloads.mockResolvedValue([
          { key: "offload_1" },
          { key: "offload_2" },
        ]);
      } finally {
        process.env[ENV_VARS.NODE_ENV] = previousEnv;
      }
    });

    it("should propagate errors if KVS fails to open", async () => {
      // Overwrite the default resolved value from top-level mock
      const errorMsg = "KVS Init Failed";
      apifyMock.openKeyValueStore.mockRejectedValueOnce(new Error(errorMsg));

      // Instantiate a new manager locally so `#kvStore` is null (since it was populated in beforeEach for other tests if init/cleanup was called)
      const freshManager = new WebhookManager();

      await expect(freshManager.cleanup()).rejects.toThrow(errorMsg);
    });

    it("should purge expired webhooks and their resources", async () => {
      await manager.cleanup();

      // Should have queried DB for offloaded payloads for wh_expired
      expect(logRepositoryMock.findOffloadedPayloads).toHaveBeenCalledWith(
        "wh_expired",
      );

      // Should have deleted KVS records
      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith(
        "offload_1",
        null,
      );
      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith(
        "offload_2",
        null,
      );

      // Should have deleted logs by Webhook ID
      expect(logRepositoryMock.deleteLogsByWebhookId).toHaveBeenCalledWith(
        "wh_expired",
      );

      // Webhook manager state should be saved
      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith(
        KVS_KEYS.STATE,
        expect.objectContaining({
          wh_active: expect.objectContaining({
            expiresAt: expect.any(String),
          }),
        }),
      );

      // Internal webhooks size should be 1
      expect(manager.webhookCount).toBe(1);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 2, webhookId: "wh_expired" }),
        LOG_MESSAGES.CLEANUP_DELETED_PAYLOADS,
      );
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: "wh_expired" }),
        LOG_MESSAGES.CLEANUP_WEBHOOK_REMOVED,
      );
    });

    it("should swallow and log KVS deletion failures", async () => {
      // Attempt to make setValue fail for offloaded payloads specifically (but not the 'STATE' update)
      keyValueStoreMock.setValue.mockImplementation(async (key, _val) => {
        if (key.startsWith("offload")) throw new Error("Delete failed");
        return undefined;
      });

      await manager.cleanup();

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: "offload_1", err: expect.any(Object) }),
        LOG_MESSAGES.KVS_DELETE_FAILED,
      );
      // It should still proceed with DB deletion
      expect(logRepositoryMock.deleteLogsByWebhookId).toHaveBeenCalledWith(
        "wh_expired",
      );
      // Ensure the cleanup successfully bypassed sending positive payload deletion logs when 0 entries worked
      expect(loggerMock.info).not.toHaveBeenCalledWith(
        expect.any(Object),
        LOG_MESSAGES.CLEANUP_DELETED_PAYLOADS,
      );
    });

    it("should continue cleaning subsequent webhooks even if previous fails", async () => {
      // Create a second expired webhook
      manager.addWebhookForTest("wh_expired2", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });
      expect(manager.webhookCount).toBe(1 + 1 + 1); // wh_expired, wh_active, wh_expired2

      // First call (for wh_expired) will throw, but it shouldn't stop processing wh_expired2
      logRepositoryMock.findOffloadedPayloads.mockRejectedValueOnce(
        new Error("Resource DB error on 1"),
      );

      // Let the second one return an empty list natively
      logRepositoryMock.findOffloadedPayloads.mockResolvedValueOnce([]);

      await manager.cleanup();

      // wh_expired failed but is removed from internal state before breaking that individual loop block
      // wh_expired2 should have been fully processed too. We remain with just "wh_active"
      expect(manager.webhookCount).toBe(1);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: "wh_expired",
          err: expect.any(Object),
        }),
        LOG_MESSAGES.CLEANUP_WEBHOOK_FAILED,
      );

      // Verify the loop executed for the second webhook
      expect(logRepositoryMock.findOffloadedPayloads).toHaveBeenCalledWith(
        "wh_expired2",
      );
      expect(logRepositoryMock.deleteLogsByWebhookId).toHaveBeenCalledWith(
        "wh_expired2",
      );
    });

    it("should safely swallow and log DB deletion failures", async () => {
      logRepositoryMock.deleteLogsByWebhookId.mockRejectedValue(
        new Error("DB Failed"),
      );

      await manager.cleanup();

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: "wh_expired",
          err: expect.any(Object),
        }),
        LOG_MESSAGES.CLEANUP_WEBHOOK_FAILED,
      );
      // It should still remove the webhook from memory!
      expect(manager.webhookCount).toBe(1);
    });

    it("should swallow and log vacuumDb errors during cleanup", async () => {
      // Make vacuumDb fail
      duckDbMock.vacuumDb.mockRejectedValueOnce(new Error("Vacuum error"));

      const managerWithVacuum = new WebhookManager({
        config: { vacuumEnabled: true, vacuumIntervalMs: 0 },
      });
      managerWithVacuum.resetVacuumForTest();

      managerWithVacuum.addWebhookForTest("wh_vacuum_fail", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });

      await managerWithVacuum.cleanup();

      expect(duckDbMock.vacuumDb).toHaveBeenCalled();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.VACUUM_FAILED,
      );
    });

    it("should track last vacuum time on success and cover pruning branches", async () => {
      const managerWithVacuum = new WebhookManager({
        config: { vacuumEnabled: true, vacuumIntervalMs: 0 },
      });
      managerWithVacuum.resetVacuumForTest();

      duckDbMock.vacuumDb.mockResolvedValue(undefined);
      // Cover branch - item without key and happy path
      logRepositoryMock.findOffloadedPayloads.mockResolvedValue([
        { key: "key1" },
        { key: assertType(null) }, // Trigger branch
        assertType(null), // Trigger branch
      ]);

      managerWithVacuum.addWebhookForTest("wh_vacuum", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });

      await managerWithVacuum.cleanup();

      expect(duckDbMock.vacuumDb).toHaveBeenCalled();
      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith("key1", null);

      // If we call cleanup again immediately, vacuum should NOT trigger because
      // #lastVacuumTime was updated to "now"
      duckDbMock.vacuumDb.mockClear();
      await managerWithVacuum.cleanup();
      expect(duckDbMock.vacuumDb).not.toHaveBeenCalled();
    });

    it("should allow resetting vacuum time via resetVacuumForTest", async () => {
      const VACUUM_INTERVAL = APP_CONSTS.MS_PER_SECOND;
      const EXPIRES_AT = "2000-01-01T00:00:00Z";
      const managerWithVacuum = new WebhookManager({
        config: { vacuumEnabled: true, vacuumIntervalMs: VACUUM_INTERVAL },
      });

      // Seed something to allow 'changed' block
      managerWithVacuum.addWebhookForTest("wh", { expiresAt: EXPIRES_AT });
      logRepositoryMock.findOffloadedPayloads.mockResolvedValue([]);

      // 1. Initial State: lastVacuumTime is 0, so first call WILL vacuum
      await managerWithVacuum.cleanup();
      expect(duckDbMock.vacuumDb).toHaveBeenCalledTimes(1);
      duckDbMock.vacuumDb.mockClear();

      // 2. Call again immediately - lastVacuumTime is now "recent", so should NOT vacuum
      managerWithVacuum.addWebhookForTest("wh2", { expiresAt: EXPIRES_AT });
      await managerWithVacuum.cleanup();
      expect(duckDbMock.vacuumDb).not.toHaveBeenCalled();

      // 3. Reset and call - should vacuum
      managerWithVacuum.resetVacuumForTest();
      managerWithVacuum.addWebhookForTest("wh3", { expiresAt: EXPIRES_AT });

      await managerWithVacuum.cleanup();
      expect(duckDbMock.vacuumDb).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateRetention", () => {
    it("should extend expiration of active webhooks only", async () => {
      const retention = TEST_RETENTION;
      const expectedFutureMs = Date.now() + retention * APP_CONSTS.MS_PER_HOUR;

      // Start with a SOONER expiration (e.g. 1 hour from now)
      manager.addWebhookForTest("wh_active", {
        expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      });
      manager.addWebhookForTest("wh_expired", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });

      await manager.updateRetention(retention);

      const activeData = manager.getWebhookData("wh_active");
      const expiredData = manager.getWebhookData("wh_expired");

      expect(activeData).toBeDefined();
      expect(expiredData).toBeDefined();

      expect(new Date(activeData?.expiresAt || "").getTime()).toBe(
        expectedFutureMs,
      );
      expect(new Date(expiredData?.expiresAt || "").getTime()).toBeLessThan(
        Date.now(),
      ); // Remains unmodified

      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith(
        KVS_KEYS.STATE,
        expect.objectContaining({
          wh_active: expect.objectContaining({
            expiresAt: expect.any(String),
          }),
        }),
      );
    });

    it("should extend expiration and log only if transition is significant", async () => {
      manager.addWebhookForTest("wh_active", {
        expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      });

      // 1. Small extension (e.g. half of the suppression threshold)
      const smallExtensionFactor = 2;
      const smallExtensionMs =
        APP_CONSTS.RETENTION_LOG_SUPPRESSION_MS / smallExtensionFactor;
      const smallRetention = 1 + smallExtensionMs / ONE_HOUR_MS;
      await manager.updateRetention(smallRetention);

      // Should NOT log
      expect(loggerMock.info).not.toHaveBeenCalledWith(
        expect.any(Object),
        LOG_MESSAGES.RETENTION_REFRESHED,
      );

      // 2. Large extension (e.g. 2 hours)
      const largeRetention = 2;
      await manager.updateRetention(largeRetention);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ retentionHours: largeRetention }),
        LOG_MESSAGES.RETENTION_REFRESHED,
      );
    });

    it("should disregard shortening retention to prevent accidental loss", async () => {
      const longRetention = 10;
      manager.addWebhookForTest("wh_long", {
        expiresAt: new Date(
          Date.now() + longRetention * ONE_HOUR_MS,
        ).toISOString(),
      });

      // Try to shorten to 1 hour
      await manager.updateRetention(1);

      const data = manager.getWebhookData("wh_long");
      // Should remain at 10 hours
      expect(new Date(data?.expiresAt || "").getTime()).toBeGreaterThan(
        Date.now() + ONE_HOUR_MS,
      );
      expect(keyValueStoreMock.setValue).not.toHaveBeenCalled();
    });

    it("should yield coverage for invalid dates and non-finite expiry", async () => {
      const invalidDate = "not-a-date";
      // Seed invalid date directly to cover branch
      manager.addWebhookForTest("wh_bad", { expiresAt: invalidDate });

      const longRetention = 10;
      await manager.updateRetention(longRetention);

      // wh_bad should be skipped in loop due to !Number.isFinite check
      expect(manager.getWebhookData("wh_bad")?.expiresAt).toBe(invalidDate);
    });

    it("should reject invalid retentions explicitly", async () => {
      await expect(
        manager.updateRetention(INVALID_RETENTION_NEG),
      ).rejects.toThrow(
        ERROR_MESSAGES.INVALID_RETENTION(INVALID_RETENTION_NEG),
      );
      await expect(manager.updateRetention(INVALID_ZERO)).rejects.toThrow(
        ERROR_MESSAGES.INVALID_RETENTION(INVALID_ZERO),
      );
      const invalidInput = "hello";
      // @ts-expect-error - Testing invalid input
      await expect(manager.updateRetention(invalidInput)).rejects.toThrow(
        // @ts-expect-error - Testing invalid input
        ERROR_MESSAGES.INVALID_RETENTION(invalidInput),
      );
      // NaN is technically a number but semantically invalid
      await expect(manager.updateRetention(NaN)).rejects.toThrow(
        ERROR_MESSAGES.INVALID_RETENTION(NaN),
      );
    });
  });

  describe("Test Mode Utility Functions", () => {
    /** @type {string | undefined} */
    let previousEnv;

    beforeEach(() => {
      previousEnv = process.env[ENV_VARS.NODE_ENV];
    });

    afterEach(() => {
      process.env[ENV_VARS.NODE_ENV] = previousEnv;
    });

    it("adds and checks webhooks only in test mode", () => {
      const webhookIds = ["test_1", "test_2"];

      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;
      manager.addWebhookForTest(webhookIds[0], {
        expiresAt: new Date().toISOString(),
      });
      expect(manager.hasWebhook(webhookIds[0])).toBe(true);

      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
      manager.addWebhookForTest(webhookIds[1], {
        expiresAt: new Date().toISOString(),
      });
      expect(manager.hasWebhook(webhookIds[1])).toBe(false);
      // Verify hasWebhook also returns false for existing ids when in production mode
      expect(manager.hasWebhook(webhookIds[0])).toBe(false);
    });
  });
});
