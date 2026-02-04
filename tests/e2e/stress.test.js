import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { apifyMock } from "../setup/helpers/shared-mocks.js";

// Mock Apify
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Stress Tests", () => {
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

  test("Memory usage should remain stable under concurrent high load", async () => {
    const initialMemory = process.memoryUsage().heapUsed;
    const TOTAL_REQUESTS = 1000;
    const CONCURRENCY = 50; // 50 requests in parallel

    // Process in batches to control concurrency
    for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENCY) {
      const batchPromises = [];

      for (let j = 0; j < CONCURRENCY; j++) {
        if (i + j >= TOTAL_REQUESTS) break;

        const p = appClient
          .post(`/webhook/${webhookId}`)
          .send({ data: `payload-${i + j}`, timestamp: Date.now() })
          .expect(200);
        batchPromises.push(p);
      }

      await Promise.all(batchPromises);

      // Clear mocks periodically to avoid memory leaks from accumulated calls
      if (i % 200 === 0) {
        jest.mocked(apifyMock.pushData).mockClear();
      }
    }

    // Force garbage collection if possible (requires --expose-gc)
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryDiffMB = (finalMemory - initialMemory) / 1024 / 1024;

    console.log(
      `Memory growth after ${TOTAL_REQUESTS} concurrent requests: ${memoryDiffMB.toFixed(
        2,
      )} MB`,
    );

    // Expect memory growth to be reasonable (e.g., < 100MB for 1000 requests including overhead)
    expect(memoryDiffMB).toBeLessThan(100);
  }, 60000); // Increased timeout for load
});
