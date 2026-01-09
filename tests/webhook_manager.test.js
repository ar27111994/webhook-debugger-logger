import { jest, describe, test, expect, beforeEach } from "@jest/globals";

jest.unstable_mockModule("apify", () => ({
  Actor: {
    openKeyValueStore: jest.fn(),
  },
}));

const { Actor } = await import("apify");
const { WebhookManager } = await import("../src/webhook_manager.js");

describe("WebhookManager", () => {
  /** @type {import('../src/webhook_manager.js').WebhookManager} */
  let webhookManager;
  /** @type {any} */
  let mockKvStore;

  beforeEach(() => {
    mockKvStore = {
      getValue: jest.fn(),
      setValue: jest.fn(),
    };
    jest
      .mocked(Actor.openKeyValueStore)
      .mockResolvedValue(/** @type {any} */ (mockKvStore));
    webhookManager = new WebhookManager();
  });

  test("init() should restore webhooks from state", async () => {
    const savedState = { wh_123: { expiresAt: "2099-01-01T00:00:00Z" } };
    mockKvStore.getValue.mockResolvedValue(savedState);

    await webhookManager.init();

    expect(webhookManager.webhooks.size).toBe(1);
    expect(webhookManager.webhooks.get("wh_123")).toEqual(savedState.wh_123);
  });

  test("init() should handle corrupted or missing state gracefully", async () => {
    mockKvStore.getValue.mockResolvedValue(null);
    await webhookManager.init();
    expect(webhookManager.webhooks.size).toBe(0);

    mockKvStore.getValue.mockRejectedValue(new Error("Storage failure"));
    await webhookManager.init(); // Should not throw
    expect(webhookManager.webhooks.size).toBe(0);
  });

  test("generateWebhooks() should create IDs and persist", async () => {
    await webhookManager.init();
    const ids = await webhookManager.generateWebhooks(2, 24);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^wh_/);
    expect(webhookManager.webhooks.size).toBe(2);
    expect(mockKvStore.setValue).toHaveBeenCalled();
  });

  test("isValid() should verify expiry correctly", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 10000).toISOString();
    const past = new Date(now.getTime() - 10000).toISOString();

    webhookManager.webhooks.set("wh_future", { expiresAt: future });
    webhookManager.webhooks.set("wh_past", { expiresAt: past });

    expect(webhookManager.isValid("wh_future")).toBe(true);
    expect(webhookManager.isValid("wh_past")).toBe(false);
    expect(webhookManager.isValid("non_existent")).toBe(false);
  });

  test("cleanup() should remove expired hooks", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.webhooks.set("wh_past", { expiresAt: past });
    webhookManager.webhooks.set("wh_active", {
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });

    await webhookManager.init();
    await webhookManager.cleanup();

    expect(webhookManager.webhooks.has("wh_past")).toBe(false);
    expect(webhookManager.webhooks.has("wh_active")).toBe(true);
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

  test("persist() should handle setValue errors gracefully", async () => {
    mockKvStore.setValue.mockRejectedValue(new Error("Write failure"));
    await webhookManager.init();
    webhookManager.webhooks.set("wh_test", {
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });
    // Should not throw
    await webhookManager.persist();
    expect(mockKvStore.setValue).toHaveBeenCalled();
  });

  test("persist() should handle non-Error thrown values", async () => {
    mockKvStore.setValue.mockRejectedValue("String error");
    await webhookManager.init();
    webhookManager.webhooks.set("wh_test", {
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
    webhookManager.webhooks.set("wh_a", { expiresAt: expiry });
    webhookManager.webhooks.set("wh_b", { expiresAt: expiry });

    const active = webhookManager.getAllActive();
    expect(active).toHaveLength(2);
    expect(active[0]).toHaveProperty("id");
    expect(active[0]).toHaveProperty("expiresAt");
  });
});
