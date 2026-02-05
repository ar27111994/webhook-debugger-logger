import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  apifyMock,
  constsMock,
  duckDbMock,
  loggerMock,
} from "../setup/helpers/shared-mocks.js";

/**
 * @typedef {import('../setup/helpers/shared-mocks.js').KeyValueStoreMock} KeyValueStore
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 */

// ⭐ CONFIGURE BEFORE IMPORTING MODULE
constsMock.DUCKDB_VACUUM_ENABLED = true;
constsMock.DUCKDB_VACUUM_INTERVAL_MS = 0;

await setupCommonMocks({
  apify: true,
  repositories: true,
  consts: true,
  logger: true,
  db: true,
});

const Actor = apifyMock;
const { WebhookManager } = await import("../../src/webhook_manager.js");

describe("WebhookManager - Vacuum Tests", () => {
  useMockCleanup();

  /** @type {WebhookManager} */
  let webhookManager;
  /** @type {KeyValueStore} */
  let mockKvStore;

  beforeEach(async () => {
    mockKvStore = await Actor.openKeyValueStore();
    jest.mocked(mockKvStore.getValue).mockReset().mockResolvedValue(null);
    jest.mocked(mockKvStore.setValue).mockReset().mockResolvedValue(undefined);

    webhookManager = new WebhookManager();
  });

  test("cleanup() should trigger vacuum if enabled", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.addWebhookForTest("wh_past", { expiresAt: past });

    duckDbMock.vacuumDb.mockResolvedValue(undefined);

    await webhookManager.init();
    await webhookManager.cleanup();

    expect(duckDbMock.vacuumDb).toHaveBeenCalled();
  });

  test("cleanup() should handle vacuum failures", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    webhookManager.addWebhookForTest("wh_past", { expiresAt: past });

    duckDbMock.vacuumDb.mockRejectedValue(new Error("Vacuum Fail"));

    await webhookManager.init();
    await webhookManager.cleanup();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      "DuckDB vacuum failed",
    );
  });
});
