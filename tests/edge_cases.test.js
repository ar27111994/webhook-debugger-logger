import { jest } from "@jest/globals";

// Mock Apify
jest.unstable_mockModule("apify", async () => {
  const { createApifyMock } = await import("./helpers/apify-mock.js");
  return {
    Actor: createApifyMock({
      maxPayloadSize: 1024, // 1KB for testing
      enableJSONParsing: true,
    }),
  };
});

const request = (await import("supertest")).default;
const { app, webhookManager } = await import("../src/main.js");
const { Actor } = await import("apify");

describe("Edge Case Tests", () => {
  let webhookId;

  beforeAll(async () => {
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  test("Should handle empty request body gracefully", async () => {
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send("");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("Should reject payload exceeding maxPayloadSize", async () => {
    const largeBody = "a".repeat(2048); // 2KB, limit is 1KB
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send(largeBody);

    expect(res.statusCode).toBe(413);
    expect(res.body.error).toBe("Payload Too Large");
  });

  test("Should log but NOT crash on malformed JSON when parsing enabled", async () => {
    // Note: main.js has logic to fallback to string if JSON parsing fails
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "application/json")
      .send("{ invalid: json }");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");

    // Check if it was saved as string
    const lastCall =
      Actor.pushData.mock.calls[Actor.pushData.mock.calls.length - 1][0];
    expect(typeof lastCall.body).toBe("string");
  });

  test("Should enforce a maximum 10s cap on response delays", async () => {
    // Generate 2 webhooks so we have ids[1]
    const ids = await webhookManager.generateWebhooks(2, 1);
    const slowWebhookId = ids[1];

    // Set a very high delay directly in the Map
    const data = webhookManager.getWebhookData(slowWebhookId);
    webhookManager.webhooks.set(slowWebhookId, {
      ...data,
      responseDelayMs: 15000,
    });

    const startTime = Date.now();
    const res = await request(app)
      .post(`/webhook/${slowWebhookId}`)
      .send({ test: "delay" });

    const duration = Date.now() - startTime;

    expect(res.statusCode).toBe(200);
    // Should be capped at 10s
    expect(duration).toBeGreaterThanOrEqual(10000);
    expect(duration).toBeLessThan(12000);
  }, 15000);

  test("Should reject unidentifiable IPs with 400 Bad Request", async () => {
    // We use our test hook to simulate a request where the IP cannot be identified
    const res = await request(app).get("/info").set("x-simulate-no-ip", "true");

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Bad Request");
    expect(res.body.message).toContain("Client IP could not be identified");
  });
});
