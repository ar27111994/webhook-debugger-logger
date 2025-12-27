import { jest } from "@jest/globals";

// Mock Apify with configuration
jest.unstable_mockModule("apify", () => ({
  Actor: {
    init: jest.fn(),
    getInput: jest.fn().mockResolvedValue({
      authKey: "top-secret",
      rateLimitPerMinute: 2, // Low limit for easy testing
      maskSensitiveData: true,
      allowedIps: ["127.0.0.1", "192.168.1.0/24"],
    }),
    openKeyValueStore: jest.fn().mockResolvedValue({
      getValue: jest.fn().mockResolvedValue(null),
      setValue: jest.fn(),
    }),
    openDataset: jest.fn().mockResolvedValue({
      getData: jest.fn().mockResolvedValue({ items: [] }),
      pushData: jest.fn().mockResolvedValue({}),
    }),
    pushData: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    exit: jest.fn(),
  },
}));

jest.unstable_mockModule("axios", () => ({
  default: {
    post: jest.fn().mockResolvedValue({ status: 200, data: "OK" }),
  },
}));

const request = (await import("supertest")).default;
const { app, webhookManager, sseHeartbeat } = await import("../src/main.js");
const { Actor } = await import("apify");

describe("Production Readiness Tests (v2.6.0)", () => {
  let webhookId;

  beforeAll(async () => {
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(() => {
    if (sseHeartbeat) clearInterval(sseHeartbeat);
  });

  describe("Security: Rate Limiting", () => {
    test("Management endpoints should be rate limited", async () => {
      const agent = request(app);
      const testIp = "1.1.1.1";

      // 1st request - Success
      await agent
        .get("/info")
        .set("Authorization", "Bearer top-secret")
        .set("X-Forwarded-For", testIp)
        .expect(200);
      // 2nd request - Success
      await agent
        .get("/info")
        .set("Authorization", "Bearer top-secret")
        .set("X-Forwarded-For", testIp)
        .expect(200);
      // 3rd request - Failure (Rate Limit Exceeded)
      const res = await agent
        .get("/info")
        .set("Authorization", "Bearer top-secret")
        .set("X-Forwarded-For", testIp);
      expect(res.statusCode).toBe(429);
    });
  });

  describe("Security: Data Masking", () => {
    test("Sensitive headers should be masked in logs", async () => {
      const agent = request(app);

      await agent
        .post(`/webhook/${webhookId}`)
        .set("Authorization", "Bearer top-secret") // Use the correct key
        .set("Cookie", "session=123")
        .set("X-API-Key", "my-key")
        .send({ foo: "bar" });

      const matchedCall = Actor.pushData.mock.calls.find(
        (call) =>
          call[0] &&
          call[0].method === "POST" &&
          call[0].webhookId === webhookId
      );

      expect(matchedCall).toBeDefined();
      const lastPush = matchedCall[0];

      expect(lastPush.headers["authorization"]).toBe("[MASKED]");
      expect(lastPush.headers["cookie"]).toBe("[MASKED]");
      expect(lastPush.headers["x-api-key"]).toBe("[MASKED]");
      expect(lastPush.headers["host"]).toBeDefined(); // Non-sensitive header should remain
    });
  });

  describe("Security: CIDR IP Whitelisting", () => {
    test("Should allow IP within CIDR range", async () => {
      const res = await request(app)
        .post(`/webhook/${webhookId}`)
        .set("Authorization", "Bearer top-secret")
        .set("X-Forwarded-For", "192.168.1.50")
        .send({});
      expect(res.statusCode).toBe(200);
    });

    test("Should reject IP outside CIDR range", async () => {
      const res = await request(app)
        .post(`/webhook/${webhookId}`)
        .set("Authorization", "Bearer top-secret")
        .set("X-Forwarded-For", "8.8.8.8")
        .send({});
      expect(res.statusCode).toBe(403);
    });
  });
});
