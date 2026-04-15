/**
 * @file tests/unit/security/webhook_manager_hardening.test.js
 * @description Production hardening tests for WebhookManager.
 *
 * SCOPE: This file covers edge cases, concurrency, stress, and error recovery
 * that are NOT covered by the primary webhook_manager.test.js file. It specifically
 * targets:
 * - Absolute 100% Function Coverage (Defensive .catch no-op on persist chain)
 * - Robust concurrency sync using signals (not brittle tick-counting)
 * - Persist chain health after internal KVS failures
 * - getWebhookData and getAllActive return shape contracts
 * - Cleanup no-op path (no expired webhooks → no persist, no vacuum)
 * - Vacuum failure + timestamp retention (suppresses retries)
 * - Ghost Webhook pruning (invalid Date in expiresAt)
 * - Vacuum Storm prevention (concurrent cleanup serialization)
 * - State corruption resilience (Arrays, garbage strings, KVS unavailability)
 * - Stress test ID uniqueness, prefix patterns, and exact persist counts
 * - Retention overflow guard (Number.MAX_VALUE * MS_PER_HOUR → Infinity)
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import {
  useMockCleanup,
  useFakeTimers,
} from "../../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import("../../../src/webhook_manager.js").WebhookManager} WebhookManager
 */

// Setup mocks
await setupCommonMocks({
  apify: true,
  logger: true,
  db: true,
  repositories: true,
  consts: true,
});

const { apifyMock, logRepositoryMock, loggerMock, duckDbMock } =
  await import("../../setup/helpers/shared-mocks.js");
const keyValueStoreMock = await apifyMock.openKeyValueStore();
const { WebhookManager } = await import("../../../src/webhook_manager.js");
const { APP_CONSTS, WEBHOOK_ID_PREFIX, ENV_VARS, ENV_VALUES } =
  await import("../../../src/consts/app.js");

/**
 * Creates a deferred promise that exposes resolve/reject externally.
 * Used instead of brittle microtask tick-counting for concurrency tests.
 * @template T
 * @returns {{ promise: Promise<T>, resolve: (value: T) => void, reject: (reason?: any) => void }}
 */
function createDeferred() {
  /** @type {(value: any) => void} */
  let resolve;
  /** @type {(reason?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // @ts-expect-error - resolve/reject initialized in Promise constructor
  return { promise, resolve, reject };
}

describe("WebhookManager Hardening", () => {
  useMockCleanup();
  useFakeTimers();

  /** @type {WebhookManager} */
  let manager;

  beforeEach(() => {
    manager = new WebhookManager();
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z").getTime());
    process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;

    apifyMock.openKeyValueStore.mockResolvedValue(keyValueStoreMock);
    keyValueStoreMock.getValue.mockResolvedValue(null);
    keyValueStoreMock.setValue.mockResolvedValue(undefined);
  });

  describe("Concurrency & Atomicity", () => {
    it("should serialize overlapping persist calls via linearized lock", async () => {
      const enteredA = createDeferred();
      const blockA = createDeferred();

      /** @type {{id: string, size: number}[]} */
      const completions = [];
      let callCount = 0;

      keyValueStoreMock.setValue.mockImplementation(async (_key, val) => {
        callCount++;
        const myId = callCount === 1 ? "CallA" : "CallB";

        if (myId === "CallA") {
          enteredA.resolve(undefined);
          await blockA.promise; // Block A until signal
        }

        completions.push({ id: myId, size: Object.keys(val).length });
        return undefined;
      });

      const persistAPromise = manager.generateWebhooks(1, 1);

      // Wait for signal that A has entered the mock and is blocking
      await enteredA.promise;

      const persistBPromise = manager.generateWebhooks(1, 1);

      // Release A
      blockA.resolve(undefined);

      await Promise.all([persistAPromise, persistBPromise]);

      expect(callCount).toBe(1 + 1);
      // A completes before B due to linearized chain
      expect(completions[0].id).toBe("CallA");
      expect(completions[1].id).toBe("CallB");
      expect(completions[completions.length - 1].size).toBe(completions.length);
    });

    it("should prevent Vacuum Storm during overlapping cleanup runs", async () => {
      manager = new WebhookManager({
        config: { vacuumEnabled: true, vacuumIntervalMs: 0 },
      });

      const entered1 = createDeferred();
      const blockDel = createDeferred();
      const ONE_SECOND_MS = APP_CONSTS.MS_PER_SECOND;

      manager.addWebhookForTest("wh1", {
        expiresAt: new Date(Date.now() - ONE_SECOND_MS).toISOString(),
      });
      manager.addWebhookForTest("wh2", {
        expiresAt: new Date(Date.now() - ONE_SECOND_MS).toISOString(),
      });

      logRepositoryMock.findOffloadedPayloads.mockImplementation(async (id) => {
        if (id === "wh1") {
          entered1.resolve(undefined);
          await blockDel.promise;
        }
        return [];
      });
      duckDbMock.vacuumDb.mockResolvedValue(undefined);

      const cleanup1Promise = manager.cleanup();

      // Wait for signal that cleanup1 has started processing wh1
      await entered1.promise;

      const cleanup2Promise = manager.cleanup();

      // Release cleanup1
      blockDel.resolve(undefined);

      await Promise.all([cleanup1Promise, cleanup2Promise]);

      // Only ONE vacuum should fire due to proactive timestamp update
      expect(duckDbMock.vacuumDb).toHaveBeenCalledTimes(1);
    });

    it("should correctly interleave updateRetention with generateWebhooks persisting the latter snapshot", async () => {
      const enteredGenerate = createDeferred();
      const blockGenerate = createDeferred();
      let callCount = 0;

      // Make setValue block on the generateWebhooks call so we know it's mid-persist
      keyValueStoreMock.setValue.mockImplementation(async (_key, _val) => {
        callCount++;
        if (callCount === 1) {
          enteredGenerate.resolve(undefined);
          await blockGenerate.promise;
        }
        return undefined;
      });

      // 1. Start generation
      const verifyCount = 2;
      const initialRetentionHours = 1;
      const genPromise = manager.generateWebhooks(
        verifyCount,
        initialRetentionHours,
      );

      // Wait until generateWebhooks enters persist and blocks
      await enteredGenerate.promise;

      // Memory state has 2 new webhooks.
      const activeGen = manager.getAllActive();

      // 2. Start updateRetention in the background. It will queue up after generateWebhooks persist via #persistPromise.
      const newRetentionHours = 5;
      const retentionPromise = manager.updateRetention(newRetentionHours);

      // Release generateWebhooks persist
      blockGenerate.resolve(undefined);

      await Promise.all([genPromise, retentionPromise]);

      const EXPECTED_PERSIST_CALLS = 2;
      expect(callCount).toBe(EXPECTED_PERSIST_CALLS);

      // Check last KVS setValue to ensure it has retention 5 updates.
      const lastSaveArgs = keyValueStoreMock.setValue.mock.calls[1];
      const savedState = lastSaveArgs[1];

      const EXPECTED_RETENTION_LOWER_BOUND_HOURS = 4;
      // Both ids should have been written with duration > 1 hr
      // specifically they were initially created with 1 hr retention then updated to 5.
      for (const webhook of activeGen) {
        const id = webhook.id;
        if (!id) continue;
        const entry = savedState[id];
        if (!entry) continue;

        // 5 hours minus something = approx > 4 hours
        expect(new Date(entry.expiresAt).getTime()).toBeGreaterThan(
          Date.now() +
          EXPECTED_RETENTION_LOWER_BOUND_HOURS * APP_CONSTS.MS_PER_HOUR,
        );
      }
    });
  });

  describe("Persist Chain Health", () => {
    it("should recover persist chain after internal KVS failure", async () => {
      // First persist fails
      keyValueStoreMock.setValue.mockRejectedValueOnce(
        new Error("KVS Write Failure"),
      );

      await manager.generateWebhooks(1, 1);

      expect(loggerMock.error).toHaveBeenCalled();

      // Second persist should still work (chain must not be broken)
      keyValueStoreMock.setValue.mockResolvedValue(undefined);
      loggerMock.error.mockClear();

      await manager.generateWebhooks(1, 1);

      // Verify second persist succeeded (setValue called with STATE key)
      const stateCallArgs = keyValueStoreMock.setValue.mock.calls.filter(
        ([key]) =>
          key !== null && typeof key === "string" && !key.startsWith("offload"),
      );
      expect(stateCallArgs.length).toBeGreaterThan(0);
      expect(loggerMock.error).not.toHaveBeenCalled();
    });

    it("should handle the case where kvStore is null during persist", async () => {
      // Force kvStore to be null by never calling init()
      // Then generate webhooks — persist() should open KVS itself
      await manager.generateWebhooks(1, 1);

      expect(apifyMock.openKeyValueStore).toHaveBeenCalled();
      expect(keyValueStoreMock.setValue).toHaveBeenCalled();
    });

    it("should survive the outer .catch safety net when error handler itself throws", async () => {
      // Trigger the defensive .catch(() => {}) by making
      // the inner try/catch's log.error throw, which propagates to the outer .catch
      keyValueStoreMock.setValue.mockRejectedValueOnce(new Error("KVS Fail"));
      loggerMock.error.mockImplementationOnce(() => {
        throw new Error("Logger crashed");
      });

      // Should not throw — the outer .catch swallows it
      await manager.generateWebhooks(1, 1);

      // Chain should remain healthy for subsequent calls
      loggerMock.error.mockImplementation(() => { });
      keyValueStoreMock.setValue.mockResolvedValue(undefined);
      await manager.generateWebhooks(1, 1);

      expect(manager.webhookCount).toBe(1 + 1);
    });
  });

  describe("Cleanup No-Op Path", () => {
    it("should not persist or vacuum when no webhooks are expired", async () => {
      const ONE_HOUR_MS = APP_CONSTS.MS_PER_HOUR;
      manager = new WebhookManager({
        config: { vacuumEnabled: true, vacuumIntervalMs: 0 },
      });

      manager.addWebhookForTest("wh_fresh", {
        expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      });

      await manager.cleanup();

      // No expired webhooks → changed stays false → no persist, no vacuum
      expect(keyValueStoreMock.setValue).not.toHaveBeenCalled();
      expect(duckDbMock.vacuumDb).not.toHaveBeenCalled();
      expect(manager.webhookCount).toBe(1);
    });

    it("should not persist or vacuum when map is empty", async () => {
      manager = new WebhookManager({
        config: { vacuumEnabled: true, vacuumIntervalMs: 0 },
      });

      await manager.cleanup();

      expect(keyValueStoreMock.setValue).not.toHaveBeenCalled();
      expect(duckDbMock.vacuumDb).not.toHaveBeenCalled();
    });
  });

  describe("Vacuum Failure & Timestamp Retention", () => {
    it("should suppress vacuum retries after failure by keeping updated timestamp", async () => {
      manager = new WebhookManager({
        config: { vacuumEnabled: true, vacuumIntervalMs: 0 },
      });

      const ONE_SECOND_MS = APP_CONSTS.MS_PER_SECOND;

      // First cleanup: vacuum fails
      duckDbMock.vacuumDb.mockRejectedValueOnce(new Error("Vacuum locked"));
      manager.addWebhookForTest("wh1", {
        expiresAt: new Date(Date.now() - ONE_SECOND_MS).toISOString(),
      });
      logRepositoryMock.findOffloadedPayloads.mockResolvedValue([]);

      await manager.cleanup();

      expect(duckDbMock.vacuumDb).toHaveBeenCalledTimes(1);
      expect(loggerMock.warn).toHaveBeenCalled();

      // Second cleanup immediately: vacuum should be suppressed
      // because timestamp was proactively updated BEFORE the await
      duckDbMock.vacuumDb.mockClear();
      manager.addWebhookForTest("wh2", {
        expiresAt: new Date(Date.now() - ONE_SECOND_MS).toISOString(),
      });

      await manager.cleanup();

      expect(duckDbMock.vacuumDb).not.toHaveBeenCalled();
    });
  });

  describe("State Corruption / Edge Case Loading", () => {
    it("should handle unexpected state shapes (Arrays) in init", async () => {
      keyValueStoreMock.getValue.mockResolvedValue([]);
      await manager.init();
      expect(manager.webhookCount).toBe(0);
    });

    it("should handle non-object garbage state in init", async () => {
      keyValueStoreMock.getValue.mockResolvedValue("string garbage");
      await manager.init();
      expect(manager.webhookCount).toBe(0);
    });

    it("should handle total KVS unavailability during init", async () => {
      apifyMock.openKeyValueStore.mockRejectedValue(
        new Error("KVS unavailable"),
      );
      await manager.init();
      expect(manager.webhookCount).toBe(0);
      expect(loggerMock.error).toHaveBeenCalled();
    });

    it("should prune Ghost Webhooks with invalid expiration dates", async () => {
      manager.addWebhookForTest("wh_ghost", {
        expiresAt: "this-is-not-a-date",
      });

      logRepositoryMock.findOffloadedPayloads.mockResolvedValue([]);

      await manager.cleanup();

      expect(manager.hasWebhook("wh_ghost")).toBe(false);
    });
  });

  describe("getAllActive Return Shape Contract", () => {
    it("should return objects with id merged into data", () => {
      const futureDate = new Date(
        Date.now() + APP_CONSTS.MS_PER_HOUR,
      ).toISOString();
      manager.addWebhookForTest("wh_shape", { expiresAt: futureDate });

      const active = manager.getAllActive();

      expect(active).toHaveLength(1);
      expect(active[0]).toEqual({
        id: "wh_shape",
        expiresAt: futureDate,
      });
    });

    it("should filter out expired webhooks from getAllActive", () => {
      const ONE_HOUR_MS = APP_CONSTS.MS_PER_HOUR;
      manager.addWebhookForTest("wh_active", {
        expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      });
      manager.addWebhookForTest("wh_expired", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });

      const active = manager.getAllActive();

      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("wh_active");
    });

    it("should return empty array when all webhooks are expired", () => {
      const ONE_HOUR_MS = APP_CONSTS.MS_PER_HOUR;
      manager.addWebhookForTest("wh_dead1", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });
      manager.addWebhookForTest("wh_dead2", {
        expiresAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      });

      expect(manager.getAllActive()).toEqual([]);
    });

    it("should return empty array when map is empty", () => {
      expect(manager.getAllActive()).toEqual([]);
    });
  });

  describe("getWebhookData Contract", () => {
    it("should return undefined for non-existent IDs", () => {
      expect(manager.getWebhookData("non_existent")).toBeUndefined();
    });

    it("should return the data object for existing IDs", () => {
      const futureDate = new Date(
        Date.now() + APP_CONSTS.MS_PER_HOUR,
      ).toISOString();
      manager.addWebhookForTest("wh_data", { expiresAt: futureDate });

      const data = manager.getWebhookData("wh_data");
      expect(data).toEqual({ expiresAt: futureDate });
    });
  });

  describe("Stress & Limits", () => {
    it("should handle exact MAX_BULK_CREATE with unique, prefixed IDs and single persist", async () => {
      const limit = APP_CONSTS.MAX_BULK_CREATE;
      const RETENTION_VAL = 24;

      const ids = await manager.generateWebhooks(limit, RETENTION_VAL);

      // Count
      expect(ids.length).toBe(limit);
      expect(manager.webhookCount).toBe(limit);

      // All IDs are unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(limit);

      // All IDs have the correct prefix
      for (const id of ids) {
        expect(id.startsWith(WEBHOOK_ID_PREFIX)).toBe(true);
      }

      // Persist was called exactly once (not N times)
      const stateSetCalls = keyValueStoreMock.setValue.mock.calls.filter(
        ([key]) => key !== null,
      );
      expect(stateSetCalls).toHaveLength(1);

      // All expiresAt dates are valid ISO strings
      for (const id of ids) {
        const data = manager.getWebhookData(id);
        expect(data).toBeDefined();
        const parsed = new Date(data?.expiresAt ?? "");
        expect(Number.isFinite(parsed.getTime())).toBe(true);
      }
    });
  });

  describe("Sanitation", () => {
    it("should reject retention that overflows to Infinity when multiplied", async () => {
      // Number.MAX_VALUE is finite, so it passes the earlier isFinite(retentionHours) check,
      // but Number.MAX_VALUE * MS_PER_HOUR overflows to Infinity — hitting the branch.
      await expect(
        manager.generateWebhooks(1, Number.MAX_VALUE),
      ).rejects.toThrow();
    });

    it("should handle non-string IDs gracefully in isValid", () => {
      const NUMERIC_ID = 123;
      // @ts-expect-error - Testing invalid input
      expect(manager.isValid(null)).toBe(false);
      // @ts-expect-error - Testing invalid input
      expect(manager.isValid({ foo: "bar" })).toBe(false);
      // @ts-expect-error - Testing invalid input
      expect(manager.isValid(NUMERIC_ID)).toBe(false);
    });
  });

  describe("Leaky Cleanup Verification", () => {
    it("should still delete from memory even if external resource deletion fails", async () => {
      const ONE_SECOND_MS = APP_CONSTS.MS_PER_SECOND;
      const webhookId = "wh_unlucky";

      manager.addWebhookForTest(webhookId, {
        expiresAt: new Date(Date.now() - ONE_SECOND_MS).toISOString(),
      });

      logRepositoryMock.findOffloadedPayloads.mockRejectedValue(
        new Error("Transient DB Error"),
      );

      await manager.cleanup();

      expect(loggerMock.error).toHaveBeenCalled();
      expect(logRepositoryMock.deleteLogsByWebhookId).not.toHaveBeenCalled();
      expect(manager.hasWebhook(webhookId)).toBe(false);
    });
  });
});
