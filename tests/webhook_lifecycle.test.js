import { jest } from "@jest/globals";

// 1. Define mocks before any imports
jest.unstable_mockModule("apify", () => ({
  Actor: {
    init: jest.fn().mockResolvedValue(),
    getInput: jest.fn(),
    openKeyValueStore: jest.fn(),
    openDataset: jest.fn(),
    pushData: jest.fn().mockResolvedValue(),
    exit: jest.fn().mockResolvedValue(),
    on: jest.fn(),
  },
}));

// 2. Dynamically import modules to ensure mocks are active
const request = (await import("supertest")).default;
const { Actor } = await import("apify");
const { initialize, shutdown, webhookManager } = await import("../src/main.js");

describe("Webhook Lifecycle & Scaling Tests", () => {
  let mockKV;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKV = {
      getValue: jest.fn(),
      setValue: jest.fn().mockResolvedValue(),
    };
    Actor.openKeyValueStore.mockResolvedValue(mockKV);
  });

  afterAll(async () => {
    await shutdown("TEST");
  });

  test("should scale up when urlCount is increased", async () => {
    // 1. Start with 1 existing webhook in KV store
    const existingId = "wh_existing123";
    const oldExpiry = new Date(Date.now() + 100000).toISOString();
    mockKV.getValue.mockResolvedValue({
      [existingId]: { expiresAt: oldExpiry },
    });

    // 2. Mock input asking for 3 webhooks
    Actor.getInput.mockResolvedValue({ urlCount: 3, retentionHours: 1 });

    const app = await initialize();

    // 3. Verify we now have 3 webhooks
    const active = webhookManager.getAllActive();
    expect(active.length).toBe(3);
    expect(active.find((w) => w.id === existingId)).toBeDefined();

    // Check that we persisted the new state
    expect(mockKV.setValue).toHaveBeenCalled();
  });

  test("should NOT delete webhooks when urlCount is decreased (Data Safety)", async () => {
    // 1. Start with 3 existing webhooks
    const state = {
      wh1: { expiresAt: new Date(Date.now() + 100000).toISOString() },
      wh2: { expiresAt: new Date(Date.now() + 100000).toISOString() },
      wh3: { expiresAt: new Date(Date.now() + 100000).toISOString() },
    };
    mockKV.getValue.mockResolvedValue(state);

    // 2. Mock input asking for only 1 webhook
    Actor.getInput.mockResolvedValue({ urlCount: 1, retentionHours: 1 });

    await initialize();

    // 3. Verify we still have all 3
    const active = webhookManager.getAllActive();
    expect(active.length).toBe(3);
  });

  test("should extend retention of existing webhooks when setting is increased", async () => {
    // 1. Start with an existing webhook set to expire in 1 hour
    const existingId = "wh_short_ttl";
    const oneHourFromNow = new Date(Date.now() + 3600000).toISOString();
    mockKV.getValue.mockResolvedValue({
      [existingId]: { expiresAt: oneHourFromNow },
    });

    // 2. Mock input asking for 24 hour retention
    Actor.getInput.mockResolvedValue({ urlCount: 1, retentionHours: 24 });

    await initialize();

    // 3. Verify retention was extended
    const webhook = webhookManager.getWebhookData(existingId);
    const newExpiry = new Date(webhook.expiresAt).getTime();
    const threshold = Date.now() + 23 * 3600000; // Should be at least 23h+ out
    expect(newExpiry).toBeGreaterThan(threshold);
  });
});
