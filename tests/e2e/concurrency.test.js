import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";

// Mock Apify
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Concurrency Tests", () => {
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
  }, 30000);

  afterAll(async () => {
    await teardownApp();
  });

  beforeEach(() => {
    jest.mocked(Actor.pushData).mockClear();
  });

  test("Should handle 50 concurrent webhook requests without data loss", async () => {
    const CONCURRENCY = 50;
    const initialCallCount = jest.mocked(Actor.pushData).mock.calls.length;
    const promises = [];

    for (let i = 0; i < CONCURRENCY; i++) {
      promises.push(
        appClient
          .post(`/webhook/${webhookId}`)
          .send({ index: i, timestamp: Date.now() }),
      );
    }

    const results = await Promise.all(promises);

    // Check all responses are 200
    results.forEach((res) => {
      expect(res.statusCode).toBe(200);
      expect(res.text).toBe("OK");
    });

    // Verify dataset push count in mock
    // Actor.pushData is called for each request
    // We expect the call count to increase by exactly CONCURRENCY
    expect(
      jest.mocked(Actor.pushData).mock.calls.length - initialCallCount,
    ).toBe(CONCURRENCY);
  });
});
