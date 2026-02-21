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

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 */

// Setup common mocks BEFORE importing source files
await setupCommonMocks({
  apify: true,
  logger: true,
  db: true,
  repositories: true,
});

const { apifyMock, logRepositoryMock, loggerMock, constsMock } =
  await import("../setup/helpers/shared-mocks.js");
const keyValueStoreMock = await apifyMock.openKeyValueStore();
const { WebhookManager } = await import("../../src/webhook_manager.js");
const { APP_CONSTS, WEBHOOK_ID_PREFIX, ENV_VARS, ENV_VALUES } =
  await import("../../src/consts/app.js");
const { KVS_KEYS } = await import("../../src/consts/storage.js");
const { ERROR_MESSAGES } = await import("../../src/consts/errors.js");
const ONE_HOUR_MS = constsMock.APP_CONSTS.MS_PER_HOUR;
const TEST_RETENTION = constsMock.APP_CONSTS.DEFAULT_RETENTION_HOURS;
const TEST_RETENTION_SHORT = 0.5;
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

      expect(apifyMock.openKeyValueStore).toHaveBeenCalled();
      expect(keyValueStoreMock.getValue).toHaveBeenCalledWith(KVS_KEYS.STATE);
      expect(manager.webhookCount).toBe(1);
      expect(loggerMock.info).toHaveBeenCalled();
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
      expect(loggerMock.error).toHaveBeenCalled();
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
      // @ts-expect-error - Testing invalid input
      await expect(
        manager.generateWebhooks(1, String(TEST_RETENTION)),
      ).rejects.toThrow(
        ERROR_MESSAGES.INVALID_RETENTION(String(TEST_RETENTION)),
      );
    });
  });

  describe("isValid / getAllActive", () => {
    it("should accurately report validity based on expiration", async () => {
      const previousEnv = process.env[ENV_VARS.NODE_ENV];
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

      manager.addWebhookForTest("wh_active", {
        expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      });
      manager.addWebhookForTest("wh_expired", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });
      manager.addWebhookForTest("wh_invalid", { expiresAt: "invalid-date" });

      expect(manager.isValid("wh_active")).toBe(true);
      expect(manager.isValid("wh_expired")).toBe(false);
      expect(manager.isValid("wh_invalid")).toBe(false); // Invalid dates evaluate to NaN, now < NaN is false
      expect(manager.isValid("non_existent")).toBe(false);

      process.env[ENV_VARS.NODE_ENV] = previousEnv;
    });

    it("should list all active webhooks accurately", async () => {
      const previousEnv = process.env[ENV_VARS.NODE_ENV];
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

      process.env[ENV_VARS.NODE_ENV] = previousEnv;
    });
  });

  describe("cleanup", () => {
    beforeEach(() => {
      const previousEnv = process.env[ENV_VARS.NODE_ENV];
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

      manager.addWebhookForTest("wh_expired", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });
      manager.addWebhookForTest("wh_active", {
        expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      });

      process.env[ENV_VARS.NODE_ENV] = previousEnv;
      // Provide log repo mock
      logRepositoryMock.findOffloadedPayloads.mockResolvedValue([
        { key: "offload_1" },
        { key: "offload_2" },
      ]);
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
        expect.any(Object),
      );

      // Internal webhooks size should be 1
      expect(manager.webhookCount).toBe(1);
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
        expect.any(String),
      );
      // It should still proceed with DB deletion
      expect(logRepositoryMock.deleteLogsByWebhookId).toHaveBeenCalledWith(
        "wh_expired",
      );
    });

    it("should safely swallow and log DB deletion failures", async () => {
      logRepositoryMock.deleteLogsByWebhookId.mockRejectedValue(
        new Error("DB Failed"),
      );

      await manager.cleanup();

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: "wh_expired" }),
        expect.any(String),
      );
      // It should still remove the webhook from memory!
      expect(manager.webhookCount).toBe(1);
    });
  });

  describe("updateRetention", () => {
    /** @type {string | undefined} */
    let previousEnv;
    beforeEach(() => {
      previousEnv = process.env[ENV_VARS.NODE_ENV];
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

      manager.addWebhookForTest("wh_active", {
        expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      }); // 1 hr future
      manager.addWebhookForTest("wh_expired", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      }); // 1 hr past
    });

    afterEach(() => {
      process.env[ENV_VARS.NODE_ENV] = previousEnv;
    });

    it("should extend expiration of active webhooks only", async () => {
      const retention = TEST_RETENTION;
      const expectedFutureMs = Date.now() + retention * APP_CONSTS.MS_PER_HOUR;

      await manager.updateRetention(retention);

      const activeData = manager.getWebhookData("wh_active") || {
        expiresAt: "",
      };
      const expiredData = manager.getWebhookData("wh_expired") || {
        expiresAt: "",
      };

      expect(new Date(activeData.expiresAt).getTime()).toBe(expectedFutureMs);
      expect(new Date(expiredData.expiresAt).getTime()).toBeLessThan(
        Date.now(),
      ); // Remains unmodified

      expect(keyValueStoreMock.setValue).toHaveBeenCalledWith(
        KVS_KEYS.STATE,
        expect.any(Object),
      );
    });

    it("should disregard shortening retention to prevent accidental loss", async () => {
      const retention = TEST_RETENTION_SHORT; // Half an hour

      await manager.updateRetention(retention);

      const activeData = manager.getWebhookData("wh_active") || {
        expiresAt: "",
      };
      // Still remains at 1 hr future because 0.5 < 1
      expect(new Date(activeData.expiresAt).getTime()).toBe(
        Date.now() + ONE_HOUR_MS,
      );

      // Should not save if no updates occurred
      expect(keyValueStoreMock.setValue).not.toHaveBeenCalled();
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
      // @ts-expect-error - Testing invalid input
      await expect(manager.updateRetention("hello")).rejects.toThrow(
        ERROR_MESSAGES.INVALID_RETENTION("hello"),
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

    it("adds webhooks artificially only in test mode", () => {
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;
      manager.addWebhookForTest("test_1", {
        expiresAt: new Date().toISOString(),
      });
      expect(manager.hasWebhook("test_1")).toBe(true);

      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
      manager.addWebhookForTest("test_2", {
        expiresAt: new Date().toISOString(),
      });
      expect(manager.hasWebhook("test_2")).toBe(false);
    });

    it("checks existence only in test mode", () => {
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;
      manager.addWebhookForTest("test_3", {
        expiresAt: new Date().toISOString(),
      });
      expect(manager.hasWebhook("test_3")).toBe(true);

      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
      expect(manager.hasWebhook("test_3")).toBe(false);
    });
  });
});
