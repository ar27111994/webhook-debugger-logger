import { jest, describe, test, expect, beforeEach } from "@jest/globals";

/**
 * @typedef {import('../setup/helpers/shared-mocks.js').KeyValueStoreMock} KeyValueStore
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 */

import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

import {
  apifyMock,
  logRepositoryMock,
  constsMock,
  duckDbMock,
} from "../setup/helpers/shared-mocks.js";

await setupCommonMocks({
  apify: true,
  repositories: true,
  consts: true,
  logger: true,
  db: true,
});

const Actor = apifyMock;
const { WebhookManager } = await import("../../src/webhook_manager.js");

describe("WebhookManager", () => {
  useMockCleanup();

  /** @type {WebhookManager} */
  let webhookManager;
  /** @type {KeyValueStore} */
  let mockKvStore;

  beforeEach(async () => {
    // Reuse the global mock store provided by apifyMock
    mockKvStore = await Actor.openKeyValueStore();

    // Reset default implementations
    jest.mocked(mockKvStore.getValue).mockReset().mockResolvedValue(null);
    jest.mocked(mockKvStore.setValue).mockReset().mockResolvedValue(undefined);

    webhookManager = new WebhookManager();
  });

  test("init() should restore webhooks from state", async () => {
    const savedState = { wh_123: { expiresAt: "2099-01-01T00:00:00Z" } };
    jest.mocked(mockKvStore.getValue).mockResolvedValue(savedState);

    await webhookManager.init();

    expect(webhookManager.webhookCount).toBe(1);
    expect(webhookManager.getWebhookData("wh_123")).toEqual(savedState.wh_123);
  });

  test("init() should handle corrupted or missing state gracefully", async () => {
    jest.mocked(mockKvStore.getValue).mockResolvedValue(null);
    await webhookManager.init();
    expect(webhookManager.webhookCount).toBe(0);

    jest
      .mocked(mockKvStore.getValue)
      .mockRejectedValue(new Error("Storage failure"));
    await webhookManager.init(); // Should not throw
    expect(webhookManager.webhookCount).toBe(0);
  });

  test("generateWebhooks() should create IDs and persist", async () => {
    await webhookManager.init();
    const ids = await webhookManager.generateWebhooks(2, 24);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^wh_/);
    expect(webhookManager.webhookCount).toBe(2);
    expect(jest.mocked(mockKvStore.setValue)).toHaveBeenCalled();
  });

  test("isValid() should verify expiry correctly", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 10000).toISOString();
    const past = new Date(now.getTime() - 10000).toISOString();

    webhookManager.addWebhookForTest("wh_future", { expiresAt: future });
    webhookManager.addWebhookForTest("wh_past", { expiresAt: past });

    expect(webhookManager.isValid("wh_future")).toBe(true);
    expect(webhookManager.isValid("wh_past")).toBe(false);
    expect(webhookManager.isValid("non_existent")).toBe(false);
  });

  test("persist() should initialize kvStore if missing", async () => {
    // Skip init() to keep kvStore null (default constructor state)

    await webhookManager.persist();
    expect(jest.mocked(Actor.openKeyValueStore)).toHaveBeenCalled();
    expect(jest.mocked(mockKvStore.setValue)).toHaveBeenCalled();
  });

  test("cleanup() should remove expired hooks", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.addWebhookForTest("wh_past", { expiresAt: past });
    webhookManager.addWebhookForTest("wh_active", {
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });

    await webhookManager.init();
    await webhookManager.cleanup();

    expect(webhookManager.hasWebhook("wh_past")).toBe(false);
    expect(webhookManager.hasWebhook("wh_active")).toBe(true);
  });

  test("generateWebhooks() should throw if count exceeds MAX_BULK_CREATE", async () => {
    await webhookManager.init();
    await expect(webhookManager.generateWebhooks(999, 24)).rejects.toThrow(
      "Invalid count: 999. Max allowed is 10.",
    );
  });

  test("cleanup() should initialize kvStore if null", async () => {
    // Manually set past webhook and DON'T call init()
    webhookManager.addWebhookForTest("wh_uninit", {
      expiresAt: "2000-01-01T00:00:00Z",
    });

    await webhookManager.cleanup();
    expect(Actor.openKeyValueStore).toHaveBeenCalled();
  });

  test("cleanup() should delete offloaded payloads and handle errors", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.addWebhookForTest("wh_cleanup", { expiresAt: past });

    logRepositoryMock.findOffloadedPayloads.mockResolvedValue([
      { key: "key_1" },
      { key: "key_2" },
    ]);

    // Simulate one failure, one success
    jest
      .mocked(mockKvStore.setValue)
      .mockRejectedValueOnce(new Error("KVS Delete Fail"))
      .mockResolvedValueOnce(undefined);

    await webhookManager.init();
    await webhookManager.cleanup();

    expect(mockKvStore.setValue).toHaveBeenCalledWith("key_1", null);
    expect(mockKvStore.setValue).toHaveBeenCalledWith("key_2", null);
    expect(webhookManager.hasWebhook("wh_cleanup")).toBe(false);
  });

  test("cleanup() should handle log deletion errors", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.addWebhookForTest("wh_err", { expiresAt: past });
    logRepositoryMock.deleteLogsByWebhookId.mockRejectedValue(
      new Error("DB Delete Fail"),
    );

    await webhookManager.init();
    await webhookManager.cleanup(); // Should not throw

    expect(webhookManager.hasWebhook("wh_err")).toBe(false);
  });

  test("cleanup() should trigger vacuum if enabled", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.addWebhookForTest("wh_past", { expiresAt: past });

    // Enable vacuum via mock
    Object.defineProperty(constsMock, "DUCKDB_VACUUM_ENABLED", {
      value: true,
    });
    Object.defineProperty(constsMock, "DUCKDB_VACUUM_INTERVAL_MS", {
      value: 0,
    });

    duckDbMock.vacuumDb.mockResolvedValue(undefined);

    await webhookManager.init();
    await webhookManager.cleanup();

    expect(duckDbMock.vacuumDb).toHaveBeenCalled();

    // Reset consts for other tests
    Object.defineProperty(constsMock, "DUCKDB_VACUUM_ENABLED", {
      value: false,
    });
  });

  test("cleanup() should handle vacuum failures", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.addWebhookForTest("wh_past", { expiresAt: past });

    Object.defineProperty(constsMock, "DUCKDB_VACUUM_ENABLED", {
      value: true,
    });
    Object.defineProperty(constsMock, "DUCKDB_VACUUM_INTERVAL_MS", {
      value: -1,
    });
    duckDbMock.vacuumDb.mockRejectedValue(new Error("Vacuum Fail"));

    await webhookManager.init();
    await webhookManager.cleanup();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      "DuckDB vacuum failed",
    );

    Object.defineProperty(constsMock, "DUCKDB_VACUUM_ENABLED", {
      value: false,
    });
  });

  test("generateWebhooks() should throw on invalid count (negative)", async () => {
    await webhookManager.init();
    await expect(webhookManager.generateWebhooks(-1, 24)).rejects.toThrow(
      "Invalid count: -1. Must be a non-negative integer.",
    );
  });

  test("generateWebhooks() should throw on invalid count (non-integer)", async () => {
    await webhookManager.init();
    await expect(webhookManager.generateWebhooks(1.5, 24)).rejects.toThrow(
      "Invalid count: 1.5. Must be a non-negative integer.",
    );
  });

  test("generateWebhooks() should throw on invalid retentionHours (zero)", async () => {
    await webhookManager.init();
    await expect(webhookManager.generateWebhooks(1, 0)).rejects.toThrow(
      "Invalid retentionHours: 0. Must be a positive number.",
    );
  });

  test("generateWebhooks() should throw on invalid retentionHours (negative)", async () => {
    await webhookManager.init();
    await expect(webhookManager.generateWebhooks(1, -5)).rejects.toThrow(
      "Invalid retentionHours: -5. Must be a positive number.",
    );
  });

  test("generateWebhooks() should throw on invalid retentionHours (Infinity)", async () => {
    await webhookManager.init();
    await expect(webhookManager.generateWebhooks(1, Infinity)).rejects.toThrow(
      "Invalid retentionHours: Infinity. Must be a positive number.",
    );
  });

  test("updateRetention() should throw on invalid retentionHours", async () => {
    await webhookManager.init();
    await expect(webhookManager.updateRetention(0)).rejects.toThrow(
      "Invalid retentionHours: 0. Must be a positive number.",
    );
    await expect(webhookManager.updateRetention(-1)).rejects.toThrow(
      "Invalid retentionHours: -1. Must be a positive number.",
    );
    await expect(webhookManager.updateRetention(NaN)).rejects.toThrow(
      "Invalid retentionHours: NaN. Must be a positive number.",
    );
  });

  test("updateRetention() should extend expiry and persist changes", async () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    await webhookManager.init();
    // Expiry in 1 hour
    const expiry1 = new Date(now + 3600 * 1000).toISOString();
    // Expiry in 2 hours
    const expiry2 = new Date(now + 7200 * 1000).toISOString();

    webhookManager.addWebhookForTest("wh_short", { expiresAt: expiry1 });
    webhookManager.addWebhookForTest("wh_long", { expiresAt: expiry2 });

    // Update to 24 hours
    await webhookManager.updateRetention(24);

    const short = webhookManager.getWebhookData("wh_short");
    const long = webhookManager.getWebhookData("wh_long");

    expect(short).toBeDefined();
    expect(long).toBeDefined();

    const newExpiry1 = new Date(short?.expiresAt || 0).getTime();
    const newExpiry2 = new Date(long?.expiresAt || 0).getTime();

    // Both should be approx 24 hours from now
    // Exact match expected due to fake timers
    const target = now + 24 * 3600 * 1000;
    expect(newExpiry1).toBeGreaterThanOrEqual(target);
    expect(newExpiry2).toBeGreaterThanOrEqual(target);

    // Should persist
    expect(jest.mocked(mockKvStore.setValue)).toHaveBeenCalled();

    jest.useRealTimers();
  });

  test("updateRetention() should NOT extend if new expiry is earlier", async () => {
    const now = Date.now();
    await webhookManager.init();
    const expiry = new Date(now + 3600 * 1000).toISOString(); // 1 hour
    webhookManager.addWebhookForTest("wh_test", { expiresAt: expiry });

    // Try to update to 0.5 hours (should be ignored)
    await webhookManager.updateRetention(0.5);

    const data = webhookManager.getWebhookData("wh_test");
    expect(data?.expiresAt).toBe(expiry);
  });

  test("updateRetention() should skip invalid/past expiries", async () => {
    await webhookManager.init();
    webhookManager.addWebhookForTest("wh_past", {
      expiresAt: "2000-01-01T00:00:00Z",
    });
    webhookManager.addWebhookForTest("wh_invalid", { expiresAt: "invalid" });

    await webhookManager.updateRetention(24);

    expect(webhookManager.getWebhookData("wh_past")?.expiresAt).toBe(
      "2000-01-01T00:00:00Z",
    );
  });

  test("updateRetention() should log significant updates", async () => {
    const now = Date.now();
    await webhookManager.init();
    // Expiry in 1 second
    webhookManager.addWebhookForTest("wh_test", {
      expiresAt: new Date(now + 1000).toISOString(),
    });

    await webhookManager.updateRetention(1); // 1 hour

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ retentionHours: 1 }),
      "Refreshed webhook retention",
    );
  });

  test("persist() should handle setValue errors gracefully", async () => {
    jest
      .mocked(mockKvStore.setValue)
      .mockRejectedValue(new Error("Write failure"));
    await webhookManager.init();
    webhookManager.addWebhookForTest("wh_test", {
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });
    // Should not throw
    await webhookManager.persist();
    expect(jest.mocked(mockKvStore.setValue)).toHaveBeenCalled();
  });

  test("persist() should handle non-Error thrown values", async () => {
    jest.mocked(mockKvStore.setValue).mockRejectedValue("String error");
    await webhookManager.init();
    webhookManager.addWebhookForTest("wh_test", {
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });
    // Should not throw
    await webhookManager.persist();
    expect(jest.mocked(mockKvStore.setValue)).toHaveBeenCalled();
  });

  test("getWebhookData() should return undefined for non-existent ID", () => {
    expect(webhookManager.getWebhookData("nonexistent")).toBeUndefined();
  });

  test("getAllActive() should return all webhooks with IDs", async () => {
    const expiry = new Date(Date.now() + 10000).toISOString();
    webhookManager.addWebhookForTest("wh_a", { expiresAt: expiry });
    webhookManager.addWebhookForTest("wh_b", { expiresAt: expiry });

    const active = webhookManager.getAllActive();
    expect(active).toHaveLength(2);
    expect(active[0]).toHaveProperty("id");
    expect(active[0]).toHaveProperty("expiresAt");
  });

  test("getAllActive() should filter out invalid/expired webhooks", async () => {
    const now = Date.now();
    const future = new Date(now + 10000).toISOString();
    const past = new Date(now - 10000).toISOString();

    webhookManager.addWebhookForTest("wh_valid", { expiresAt: future });
    webhookManager.addWebhookForTest("wh_expired", { expiresAt: past });

    const active = webhookManager.getAllActive();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("wh_valid");
  });

  test("hasWebhook and addWebhookForTest behavior in non-test env", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    webhookManager.addWebhookForTest("prod_test", { expiresAt: "..." });
    expect(webhookManager.hasWebhook("prod_test")).toBe(false);

    process.env.NODE_ENV = originalEnv;
  });
});
