import { jest, describe, test, expect, afterAll } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import('apify').KeyValueStore} KeyValueStore
 * @typedef {import('../../src/typedefs.js').WebhookData} WebhookData
 */

// 1. Define mocks before any imports
// 1. Define mocks before any imports
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

// 2. Dynamically import modules to ensure mocks are active
const { Actor } = await import("apify");
const { initialize, shutdown, webhookManager } =
  await import("../../src/main.js");

describe("Webhook Lifecycle & Scaling Tests", () => {
  /** @type {KeyValueStore} */
  let mockKV;

  useMockCleanup(() => {
    mockKV = /** @type {KeyValueStore} */ ({
      getValue: /** @type {KeyValueStore['getValue']} */ (jest.fn()),
      setValue: /** @type {KeyValueStore['setValue']} */ (
        jest.fn().mockResolvedValue(/** @type {never} */ (undefined))
      ),
    });
    jest.mocked(Actor.openKeyValueStore).mockResolvedValue(mockKV);
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("should scale up when urlCount is increased", async () => {
    // 1. Start with 1 existing webhook in KV store
    const existingId = "wh_existing123";
    const oldExpiry = new Date(Date.now() + 100000).toISOString();
    jest.mocked(mockKV.getValue).mockResolvedValue({
      [existingId]: { expiresAt: oldExpiry },
    });

    // 2. Mock input asking for 3 webhooks
    jest
      .mocked(Actor.getInput)
      .mockResolvedValue({ urlCount: 3, retentionHours: 1 });

    await initialize();

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
    jest.mocked(mockKV.getValue).mockResolvedValue(state);

    // 2. Mock input asking for only 1 webhook
    jest
      .mocked(Actor.getInput)
      .mockResolvedValue({ urlCount: 1, retentionHours: 1 });

    await initialize();

    // 3. Verify we still have all 3
    const active = webhookManager.getAllActive();
    expect(active.length).toBe(3);
  });

  test("should extend retention of existing webhooks when setting is increased", async () => {
    // 1. Start with an existing webhook set to expire in 1 hour
    const existingId = "wh_short_ttl";
    const oneHourFromNow = new Date(Date.now() + 3600000).toISOString();
    jest.mocked(mockKV.getValue).mockResolvedValue({
      [existingId]: { expiresAt: oneHourFromNow },
    });

    // 2. Mock input asking for 24 hour retention
    jest
      .mocked(Actor.getInput)
      .mockResolvedValue({ urlCount: 1, retentionHours: 24 });

    await initialize();

    // 3. Verify retention was extended
    const webhook = webhookManager.getWebhookData(existingId);
    expect(webhook).toBeDefined();

    expect(webhook?.expiresAt).toBeDefined();
    const newExpiry = new Date(
      /** @type {string} */ (webhook?.expiresAt),
    ).getTime();
    const threshold = Date.now() + 23 * 3600000; // Should be at least 23h+ out
    expect(newExpiry).toBeGreaterThan(threshold);
  });
});
