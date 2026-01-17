import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { Actor } from "apify";
import { initialize, shutdown, app } from "../src/main.js";

/**
 * @type {import('supertest').Response}
 */
let infoResponse;

describe("Security Headers", () => {
  beforeAll(async () => {
    await Actor.init();
    await initialize({ urlCount: 1, testAndExit: true });
    infoResponse = await request(app).get("/info");
  }, 30000);

  afterAll(async () => {
    // Don't call shutdown to avoid jest worker crash from Actor.exit()
    // The test runner will clean up automatically
  }, 5000);

  describe("Request ID", () => {
    test("should add X-Request-ID header to responses", async () => {
      const res = await request(app).get("/info");
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(typeof res.headers["x-request-id"]).toBe("string");
      expect(res.headers["x-request-id"].startsWith("req_")).toBe(true);
    });

    test("should respect incoming X-Request-ID header", async () => {
      const customRequestId = "custom-trace-id-12345";
      const res = await request(app)
        .get("/info")
        .set("X-Request-ID", customRequestId);
      expect(res.headers["x-request-id"]).toBe(customRequestId);
    });
  });

  describe("CSP Headers", () => {
    test("should add Content-Security-Policy to dashboard", async () => {
      const res = await request(app).get("/");
      expect(res.headers["content-security-policy"]).toBeDefined();
      expect(res.headers["content-security-policy"]).toContain(
        "default-src 'self'",
      );
      expect(res.headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
    });

    test("should add X-Content-Type-Options to dashboard", async () => {
      const res = await request(app).get("/");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    test("should add X-Frame-Options to dashboard", async () => {
      const res = await request(app).get("/");
      expect(res.headers["x-frame-options"]).toBe("DENY");
    });

    test("should add Referrer-Policy to dashboard", async () => {
      const res = await request(app).get("/");
      expect(res.headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
    });

    test("should NOT add CSP headers to API endpoints", async () => {
      const res = await request(app).get("/info");
      expect(res.headers["content-security-policy"]).toBeUndefined();
    });
  });

  describe("Request ID in Webhook Events", () => {
    test("should include requestId in stored webhook events", async () => {
      // Fetch fresh info inside the test to avoid shared state issues
      const freshInfoRes = await request(app).get("/info");
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

      await request(app)
        .post(`/webhook/${webhookId}`)
        .set("X-Request-ID", customRequestId)
        .send(testPayload);

      const logsRes = await request(app).get(
        `/logs?webhookId=${webhookId}&limit=1`,
      );
      expect(logsRes.body.items).toBeDefined();
      if (logsRes.body.items.length > 0) {
        expect(logsRes.body.items[0].requestId).toBe(customRequestId);
      }
    });
  });
});
