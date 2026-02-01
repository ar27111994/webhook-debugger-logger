import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

// Mock Apify
// Mock Apify
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true, logger: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");
import { assertType } from "../setup/helpers/test-utils.js";

import {
  setupBasicApifyMock,
  apifyMock,
} from "../setup/helpers/shared-mocks.js";
import { MAX_SAFE_RESPONSE_DELAY_MS } from "../../src/consts.js";

/**
 * @typedef {import("../setup/helpers/app-utils.js").App} App
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../../src/webhook_manager.js").WebhookData} WebhookData
 */

describe("Edge Case Tests", () => {
  /** @type {string} */
  let webhookId;

  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {App} */
  let _app;

  beforeAll(async () => {
    // Standardize mock setup
    setupBasicApifyMock(apifyMock, {
      input: {
        maxPayloadSize: 1024,
        enableJSONParsing: true,
      },
    });

    ({ appClient, teardownApp, app: _app } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("Should handle empty request body gracefully", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send("");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("Should reject payload exceeding maxPayloadSize", async () => {
    const largeBody = "a".repeat(2048); // 2KB, limit is 1KB
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send(largeBody);

    expect(res.statusCode).toBe(413);
    if (res.body && res.body.error) {
      expect(res.body.error).toMatch(/Payload Too Large|Entity Too Large/i);
    } else {
      expect(res.text).toMatch(/Too Large/i);
    }
  });

  test("Should log but NOT crash on malformed JSON when parsing enabled", async () => {
    // Note: main.js has logic to fallback to string if JSON parsing fails
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "application/json")
      .send("{ invalid: json }");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");

    // Check if it was saved as string
    /** @type {{body: unknown}} */
    const lastCall = assertType(
      jest.mocked(Actor.pushData).mock.calls[
        jest.mocked(Actor.pushData).mock.calls.length - 1
      ][0],
    );
    expect(typeof lastCall.body).toBe("string");
  });

  test(
    `Should enforce a maximum ${MAX_SAFE_RESPONSE_DELAY_MS / 1000}s cap on response delays`,
    async () => {
      // Generate 2 webhooks so we have ids[1]
      const ids = await webhookManager.generateWebhooks(2, 1);
      const slowWebhookId = ids[1];

      // Set a very high delay directly in the Map
      const data = webhookManager.getWebhookData(slowWebhookId);
      /** @type {WebhookData} */
      const modifiedData = {
        ...data,
        expiresAt: data?.expiresAt || new Date().toISOString(), // Ensure valid ISO string
        responseDelayMs: MAX_SAFE_RESPONSE_DELAY_MS + 5000,
      };
      webhookManager.addWebhookForTest(slowWebhookId, modifiedData);

      const startTime = Date.now();
      const res = await appClient
        .post(`/webhook/${slowWebhookId}`)
        .send({ test: "delay" });

      const duration = Date.now() - startTime;

      expect(res.statusCode).toBe(200);
      // Should be capped at 10s (MAX_SAFE_RESPONSE_DELAY_MS)
      expect(duration).toBeGreaterThanOrEqual(MAX_SAFE_RESPONSE_DELAY_MS);
      // Allow more overhead for test environment (was 13000)
      // 15000 is the uncapped delay, so anything < 14500 proves clamping happened
      expect(duration).toBeLessThan(MAX_SAFE_RESPONSE_DELAY_MS + 4500);
    },
    MAX_SAFE_RESPONSE_DELAY_MS + 6000,
  );

  test("Should reject unidentifiable IPs with 400 Bad Request", async () => {
    // We use our test hook to simulate a request where the IP cannot be identified
    const res = await appClient.get("/info").set("x-simulate-no-ip", "true");

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Bad Request");
    expect(res.body.message).toContain("Client IP could not be identified");
  });
});
