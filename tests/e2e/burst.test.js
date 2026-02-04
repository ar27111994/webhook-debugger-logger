import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

// Setup mocks
await setupCommonMocks({ apify: true, logger: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Burst Traffic Handling", () => {
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

  test("should handle 500 requests in a sudden burst without crashing", async () => {
    const REQUEST_COUNT = 500;
    const promises = [];

    for (let i = 0; i < REQUEST_COUNT; i++) {
      promises.push(
        appClient
          .post(`/webhook/${webhookId}`)
          .send({ i })
          .then((res) => res.status),
      );
    }

    const statuses = await Promise.all(promises);

    const errors = statuses.filter((s) => s !== 200 && s !== 429);
    expect(errors).toEqual([]);

    await appClient.get("/health").expect(200);
  }, 30000); // 30s timeout
});
