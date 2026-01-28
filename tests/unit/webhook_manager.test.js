import { jest, describe, test, expect, beforeEach } from "@jest/globals";

/**
 * @typedef {import('apify').KeyValueStore} KeyValueStore
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

const { Actor } = await import("apify");
const { WebhookManager } = await import("../../src/webhook_manager.js");

describe("WebhookManager", () => {
  /** @type {WebhookManager} */
  let webhookManager;
  /** @type {KeyValueStore} */
  let mockKvStore;

  beforeEach(() => {
    mockKvStore = /** @type {KeyValueStore} */ ({
      getValue: /** @type {KeyValueStore['getValue']} */ (jest.fn()),
      setValue: /** @type {KeyValueStore['setValue']} */ (jest.fn()),
    });
    jest.mocked(Actor.openKeyValueStore).mockResolvedValue(mockKvStore);
    webhookManager = new WebhookManager();
  });

  test("init() should restore webhooks from state", async () => {
    const savedState = { wh_123: { expiresAt: "2099-01-01T00:00:00Z" } };
    jest.mocked(mockKvStore.getValue).mockResolvedValue(savedState);

    await webhookManager.init();

    await webhookManager.init();

    expect(webhookManager.webhookCount).toBe(1);
    expect(webhookManager.getWebhookData("wh_123")).toEqual(savedState.wh_123);
  });

  test("init() should handle corrupted or missing state gracefully", async () => {
    jest.mocked(mockKvStore.getValue).mockResolvedValue(null);
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

    await webhookManager.cleanup();

    expect(webhookManager.hasWebhook("wh_past")).toBe(false);
    expect(webhookManager.hasWebhook("wh_active")).toBe(true);
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
});
