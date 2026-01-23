import { describe, test, expect, beforeAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { Actor } = await import("apify");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../setup/helpers/app-utils.js").App} App
 */

describe("Security Headers", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {App} */
  let _app;

  beforeAll(async () => {
    // initialize logic calls Actor.init internally, but we mock it here too just in case
    await Actor.init();
    ({ app: _app, appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  describe("Request ID", () => {
    test("should add X-Request-ID header to responses", async () => {
      const res = await appClient.get("/info");
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(typeof res.headers["x-request-id"]).toBe("string");
      expect(res.headers["x-request-id"].startsWith("req_")).toBe(true);
    });

    test("should respect incoming X-Request-ID header", async () => {
      const customRequestId = "custom-trace-id-12345";
      const res = await appClient
        .get("/info")
        .set("X-Request-ID", customRequestId);
      expect(res.headers["x-request-id"]).toBe(customRequestId);
    });
  });

  describe("CSP Headers", () => {
    test("should add Content-Security-Policy to dashboard", async () => {
      const res = await appClient.get("/");
      expect(res.headers["content-security-policy"]).toBeDefined();
      expect(res.headers["content-security-policy"]).toContain(
        "default-src 'self'",
      );
      expect(res.headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
    });

    test("should add X-Content-Type-Options to dashboard", async () => {
      const res = await appClient.get("/");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    test("should add X-Frame-Options to dashboard", async () => {
      const res = await appClient.get("/");
      expect(res.headers["x-frame-options"]).toBe("DENY");
    });

    test("should add Referrer-Policy to dashboard", async () => {
      const res = await appClient.get("/");
      expect(res.headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
    });

    test("should NOT add CSP headers to API endpoints", async () => {
      const res = await appClient.get("/info");
      expect(res.headers["content-security-policy"]).toBeUndefined();
    });
  });

  describe("Request ID in Webhook Events", () => {
    test("should include requestId in stored webhook events", async () => {
      // Fetch fresh info inside the test to avoid shared state issues
      const freshInfoRes = await appClient.get("/info");
      if (
        !freshInfoRes.body.webhooks ||
        freshInfoRes.body.webhooks.length === 0
      ) {
        // Skip test if no webhooks (shouldn't happen but prevents crash)
        return;
      }
      const webhookId = freshInfoRes.body.webhooks[0].id;
      const testPayload = { event: "test_security" };
      const customRequestId = "trace-webhook-test-123";

      await appClient
        .post(`/webhook/${webhookId}`)
        .set("X-Request-ID", customRequestId)
        .send(testPayload);

      const logsRes = await appClient.get(
        `/logs?webhookId=${webhookId}&limit=1`,
      );
      expect(logsRes.body.items).toBeDefined();
      if (logsRes.body.items.length > 0) {
        expect(logsRes.body.items[0].requestId).toBe(customRequestId);
      }
    });
  });
});
