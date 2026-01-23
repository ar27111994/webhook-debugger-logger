import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";

// Mock Apify and Axios
import { setupCommonMocks } from "./helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true });

// Mock Apify
const { setupTestApp } = await import("./helpers/app-utils.js");
const { webhookManager } = await import("../src/main.js");

/**
 * @typedef {import("./helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("./helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Large Payload Stability", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  beforeAll(async () => {
    ({ appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("Should handle 10MB payload", async () => {
    // Generate a valid ID dynamically or use one from manager
    const [webhookId] = await webhookManager.generateWebhooks(1, 1);
    const largeBody = "a".repeat(10 * 1024 * 1024); // 10MB

    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send(largeBody);

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  }, 30000); // 30s timeout for large payload
});
