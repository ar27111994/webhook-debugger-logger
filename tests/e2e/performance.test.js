/**
 * @file tests/e2e/performance.test.js
 * @description End-to-end performance tests for high-concurrency webhook ingestion.
 */
import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";

// Mock Apify
await setupCommonMocks({ apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Performance & High Concurrency", () => {
  /** @type {string} */
  let webhookId;
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  beforeAll(async () => {
    ({ appClient, teardownApp } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("Should handle 500+ concurrent requests with low latency", async () => {
    const CONCURRENCY = 500;
    const promises = [];

    // Batching to prevent socket exhaustion if needed, but 500 should be fine
    const start = Date.now();

    for (let i = 0; i < CONCURRENCY; i++) {
      promises.push(
        appClient.post(`/webhook/${webhookId}`).send({
          requestId: `perf-${i}`,
          timestamp: new Date().toISOString(),
          payload: { random: Math.random() },
        }),
      );
    }

    const results = await Promise.all(promises);
    const duration = Date.now() - start;
    const avgLatency = duration / CONCURRENCY;

    console.log(
      `[Performance] 500 concurrent requests completed in ${duration}ms (Avg: ${avgLatency.toFixed(2)}ms/req)`,
    );

    // Verify results
    results.forEach((res) => {
      expect(res.statusCode).toBe(200);
    });

    // Latency assertion: Locally with mocks, average latency should be very low (< 5ms per req on average overhead)
    // Note: Since they are concurrent, the total duration might be high due to event loop blocking,
    // but the app should remain responsive.
    expect(avgLatency).toBeLessThan(50); // Very conservative threshold for local CI
  }, 30000);

  test("Should sustain throughput under heavy load without dropping requests", async () => {
    // Push it to 1000 total across 4 batches of 250
    const BATCH_SIZE = 250;
    const BATCHES = 4;
    let totalSuccess = 0;

    for (let b = 0; b < BATCHES; b++) {
      const promises = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        promises.push(appClient.post(`/webhook/${webhookId}`).send({ b, i }));
      }
      const results = await Promise.all(promises);
      totalSuccess += results.filter((r) => r.statusCode === 200).length;
    }

    expect(totalSuccess).toBe(BATCH_SIZE * BATCHES);
    expect(jest.mocked(Actor.pushData)).toHaveBeenCalledTimes(1000 + 500); // 1000 from here + 500 from prev test
  }, 60000);
});
