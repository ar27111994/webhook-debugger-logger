import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { apifyMock } from "./helpers/shared-mocks.js";

// Mock Apify
import { setupCommonMocks } from "./helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

const request = (await import("supertest")).default;
const { app, webhookManager, initialize, shutdown } =
  await import("../src/main.js");

describe("Stress Tests", () => {
  /** @type {string} */
  let webhookId;

  beforeAll(async () => {
    await initialize();
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("Memory usage should remain stable under high load", async () => {
    const initialMemory = process.memoryUsage().heapUsed;
    const ITERATIONS = 1000; // Simulate 1000 requests

    for (let i = 0; i < ITERATIONS; i++) {
      await request(app)
        .post(`/webhook/${webhookId}`)
        .send({ data: `payload-${i}`, timestamp: Date.now() })
        .expect(200);

      // Clear mocks periodically to avoid memory leaks from accumulated calls
      if (i % 100 === 0) {
        jest.mocked(apifyMock.pushData).mockClear();
      }
    }

    // Force garbage collection if possible (requires --expose-gc)
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryDiffMB = (finalMemory - initialMemory) / 1024 / 1024;

    // console.log(
    //   `Memory growth after ${ITERATIONS} requests: ${memoryDiffMB.toFixed(
    //     2,
    //   )} MB`,
    // );

    // Expect memory growth to be reasonable (e.g., < 100MB for 1000 requests including overhead)
    // Note: This is an observation test; precise assertion depends on the environment
    expect(memoryDiffMB).toBeLessThan(100);
  }, 45000); // Increased timeout
});
