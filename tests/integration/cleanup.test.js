import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@jest/globals";

// Setup mocks
const { setupCommonMocks } = await import("../setup/helpers/mock-setup.js");
await setupCommonMocks({ apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");
import { assertType } from "../setup/helpers/test-utils.js";
import { constsMock } from "../setup/helpers/shared-mocks.js";
import { HTTP_METHODS } from "../../src/consts/index.js";

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../setup/helpers/apify-mock.js").KeyValueStoreMock} KeyValueStoreMock
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 */

describe("Data Cleanup Service", () => {
  /** @type {AppClient} */
  let _appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {KeyValueStoreMock} */
  let kvStoreMock;

  beforeAll(async () => {
    // Retrieve the default mock store (already initialized by Actor.openKeyValueStore default mock)
    kvStoreMock = assertType(await Actor.openKeyValueStore());
    // Ensure setValue is a spy we can track
    kvStoreMock.setValue.mockResolvedValue(undefined);
    jest.mocked(Actor.exit).mockResolvedValue(undefined);

    const setup = await setupTestApp();
    _appClient = setup.appClient;
    teardownApp = setup.teardownApp;
  });

  afterAll(async () => {
    await teardownApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should cleanup expired logs and offloaded payloads", async () => {
    // 1. Setup Data
    const webhookId = "wh_cleanup_test";
    webhookManager.addWebhookForTest(webhookId, {
      // Expired 1 hour ago
      expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    });

    // Insert Logs
    /** @type {LogEntry[]} */
    const logs = assertType([
      {
        id: "log_normal",
        webhookId,
        timestamp: new Date().toISOString(),
        method: HTTP_METHODS.POST,
        body: JSON.stringify({ foo: "bar" }),
      },
      {
        id: "log_offloaded",
        webhookId,
        timestamp: new Date().toISOString(),
        method: HTTP_METHODS.POST,
        // Simulate stored JSON structure for offloaded body
        body: {
          data: constsMock.OFFLOAD_MARKER_SYNC,
          key: "payload_todelete_123",
        },
      },
    ]);

    // Use repository directly to bypass middleware/validation for setup
    await logRepository.batchInsertLogs(logs);

    // Verify inserted
    const found = await logRepository.findLogs({ webhookId });
    expect(found.total).toBe(2);

    // 2. Trigger Cleanup
    await webhookManager.cleanup();

    // 3. Verify Logs Deleted
    const foundAfter = await logRepository.findLogs({ webhookId });
    expect(foundAfter.total).toBe(0);

    // 4. Verify KVS Deletion
    expect(kvStoreMock.setValue).toHaveBeenCalledWith(
      "payload_todelete_123",
      null,
    );

    // Verify Webhook removed from memory
    expect(webhookManager.hasWebhook(webhookId)).toBe(false);
  });

  it("should not delete active webhooks data", async () => {
    const webhookId = "wh_active_test";
    webhookManager.addWebhookForTest(webhookId, {
      // Expires in 1 hour
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });

    /** @type {LogEntry[]} */
    const logs = assertType([
      {
        id: "log_active",
        webhookId,
        timestamp: new Date().toISOString(),
        method: "POST",
        body: JSON.stringify({ foo: "bar" }),
      },
    ]);
    await logRepository.batchInsertLogs(logs);

    await webhookManager.cleanup();

    const found = await logRepository.findLogs({ webhookId });
    expect(found.total).toBe(1);
    expect(webhookManager.hasWebhook(webhookId)).toBe(true);
  });
});
