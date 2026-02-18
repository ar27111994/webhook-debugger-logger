import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { constsMock } from "../setup/helpers/shared-mocks.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { sleep } from "../setup/helpers/test-utils.js";
import { ENV_VARS, HTTP_STATUS } from "../../src/consts/index.js";

// Setup mocks - Use defaults so we use REAL DUCKDB
await setupCommonMocks({
  apify: true,
  logger: true,
  // Ensure we do NOT mock db or repositories
  db: false,
  repositories: false,
  consts: true, // Enable consts mock to override safe limits
});

// Override safe limits to allow high stress testing
constsMock.APP_CONSTS.MAX_SAFE_RATE_LIMIT_PER_MINUTE = 10000;
constsMock.MAX_SAFE_RATE_LIMIT_PER_MINUTE = 10000;
constsMock.APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE = 10000;
constsMock.DEFAULT_RATE_LIMIT_PER_MINUTE = 10000;

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Connection Pool Limits", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {string} */
  let webhookId;

  useMockCleanup();

  beforeAll(async () => {
    // Prevent INPUT env var from polluting tests and overriding rate limits
    delete process.env[ENV_VARS.INPUT];

    // Set high rate limit to allow stress testing the DB pool
    ({ appClient, teardownApp } = await setupTestApp({
      rateLimitPerMinute: 1000,
    }));
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];

    // Seed some data
    await appClient
      .post(`/webhook/${webhookId}`)
      .send({ message: "Seed Data" });
    await sleep(500); // Allow write to settle
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should handle high concurrency reads without exhausting resources", async () => {
    // 200 concurrent reads
    // If the DB logic was "one connection per request" without release, this would eventually crash or timeout.
    // We want to verify it handles the load.
    const READ_COUNT = 200;
    const promises = [];

    for (let i = 0; i < READ_COUNT; i++) {
      promises.push(
        appClient.get(`/logs?webhookId=${webhookId}&limit=1`).then((res) => {
          if (res.status !== HTTP_STATUS.OK) {
            console.error(`Request ${i} failed: ${res.status}`, res.body);
          }
          return res.status;
        }),
      );
    }

    const statuses = await Promise.all(promises);

    // Check for 200s
    // Since we raised the rate limit, we expect the DB to handle this.
    // If connection pool exhausts, we'll see 500s.
    const errors = statuses.filter((s) => s !== HTTP_STATUS.OK);
    expect(errors.length).toBe(0);

    // Check health after
    await appClient.get("/health").expect(HTTP_STATUS.OK);
  }, 30000);
});
