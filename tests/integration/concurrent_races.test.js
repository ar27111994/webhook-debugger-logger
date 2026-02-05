import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { HTTP_STATUS } from "../../src/consts.js";
import { sleep } from "../setup/helpers/test-utils.js";

// Setup mocks
await setupCommonMocks({ apify: true, logger: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Concurrent Read/Write Races", () => {
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

  test("should handle concurrent POSTs and GETs (logs) without locking errors", async () => {
    const WRITES = 50;
    const operations = [];

    for (let i = 0; i < WRITES; i++) {
      operations.push(
        appClient
          .post(`/webhook/${webhookId}`)
          .send({ op: "write", i })
          .expect(HTTP_STATUS.OK),
      );

      if (i % 5 === 0) {
        operations.push(
          appClient
            .get(`/logs?webhookId=${webhookId}&limit=10`)
            .expect(HTTP_STATUS.OK),
        );
      }
    }

    await Promise.all(operations);

    await sleep(500);

    const logsRes = await appClient
      .get(`/logs?webhookId=${webhookId}`)
      .expect(HTTP_STATUS.OK);

    expect(Array.isArray(logsRes.body.items)).toBe(true);
  });
});
