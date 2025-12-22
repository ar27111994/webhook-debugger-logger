import { jest } from "@jest/globals";

jest.unstable_mockModule("apify", () => ({
  Actor: {
    openKeyValueStore: jest.fn(),
  },
}));

const { Actor } = await import("apify");
const { WebhookManager } = await import("../src/webhook_manager.js");

describe("WebhookManager", () => {
  let webhookManager;
  let mockKvStore;

  beforeEach(() => {
    mockKvStore = {
      getValue: jest.fn(),
      setValue: jest.fn(),
    };
    Actor.openKeyValueStore.mockResolvedValue(mockKvStore);
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
});
