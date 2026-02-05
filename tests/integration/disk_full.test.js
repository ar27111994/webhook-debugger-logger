import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { sleep } from "../setup/helpers/test-utils.js";
import {
  logRepositoryMock,
  loggerMock,
} from "../setup/helpers/shared-mocks.js";
import { HTTP_STATUS } from "../../src/consts.js";

// Setup mocks first
// Ensure real SyncService consumes events while mocking the repository failure
await setupCommonMocks({
  apify: true,
  logger: true,
  repositories: true,
});

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Disk Full / Write Failure Resilience", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {string} */
  let webhookId;

  useMockCleanup();

  beforeAll(async () => {
    ({ appClient, teardownApp } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should handle DuckDB write failure gracefully (LogRepository)", async () => {
    const dbError = new Error("IO Error: Disk is full");
    logRepositoryMock.insertLog.mockRejectedValueOnce(dbError);

    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .send({ data: "crash_test" });

    expect(res.statusCode).toBe(HTTP_STATUS.OK);

    await sleep(200);

    expect(logRepositoryMock.insertLog).toHaveBeenCalled();

    // Verify the error was logged
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.anything(),
      }),
      expect.stringContaining("Real-time insert failed"),
    );
  });
});
