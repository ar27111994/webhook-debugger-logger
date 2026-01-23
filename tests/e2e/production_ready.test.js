import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { getLastAxiosConfig, assertType } from "../setup/helpers/test-utils.js";
/**
 * @typedef {import("../setup/helpers/shared-mocks.js").AxiosMock} AxiosMock
 * @typedef {import("../../src/typedefs.js").WebhookEvent} WebhookEvent
 */

// Mock Apify and Axios
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
await setupCommonMocks({ axios: true, apify: true });

const request = (await import("supertest")).default;
const { app, webhookManager, sseHeartbeat, initialize, shutdown } =
  await import("../../src/main.js");
const { Actor } = await import("apify");
const { createDatasetMock } = await import("../setup/helpers/shared-mocks.js");

describe("Production Readiness Tests (v2.6.0)", () => {
  /** @type {string} */
  let webhookId;

  useMockCleanup();

  beforeAll(async () => {
    jest.mocked(Actor.getInput).mockResolvedValue({
      authKey: "top-secret",
      rateLimitPerMinute: 2,
      maskSensitiveData: true,
      allowedIps: ["127.0.0.1", "192.168.1.0/24"],
    });
    await initialize();
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    if (sseHeartbeat) clearInterval(sseHeartbeat);
    try {
      await shutdown("TEST_COMPLETE");
    } catch (e) {
      console.warn(
        "Cleanup shutdown failed:",
        /** @type {Error} */ (e).message,
      );
    }
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

      const matchedCallArgs = assertType(
        jest.mocked(Actor.pushData).mock.calls,
      ).find(
        /** @param {any[]} call */
        (call) =>
          assertType(call[0]).method === "POST" &&
          assertType(call[0]).webhookId === webhookId,
      );
      const matchedCall = /** @type {Partial<WebhookEvent> | undefined} */ (
        matchedCallArgs?.[0]
      );

      expect(matchedCall).toBeDefined();
      if (!matchedCall)
        throw new Error("Test setup failed: no matching call found");
      expect(matchedCall?.headers).toBeDefined();
      expect(matchedCall?.headers?.authorization).toBe("[MASKED]");
      expect(matchedCall?.headers?.cookie).toBe("[MASKED]");
      expect(matchedCall?.headers?.["x-api-key"]).toBe("[MASKED]");
      expect(matchedCall?.headers?.host).toBeDefined();
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

  describe("Hardening: Replay Logic", () => {
    test("Should strip content-length and transmission headers during replay", async () => {
      const targetUrl = "http://example.com/replay-target";
      const eventId = "evt_123";

      // Mock an event with a small content-length but a large body
      const mockEvent = {
        id: eventId,
        method: "POST",
        webhookId,
        headers: {
          "content-type": "application/json",
          "content-length": "10", // Obviously too small for the body below
          authorization: "[MASKED]",
          host: "original.com",
          connection: "keep-alive",
        },
        body: '{\n  "hello": "world"\n}', // 22 characters
      };

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock([mockEvent]));

      const res = await request(app)
        .post(`/replay/${webhookId}/${eventId}?url=${targetUrl}`)
        .set("Authorization", "Bearer top-secret")
        .expect(200);

      const { default: axiosMock } = await import("axios");
      const axiosConfig = getLastAxiosConfig(axiosMock, null);

      expect(axiosConfig).toBeDefined();
      expect(axiosConfig.url).toBe(targetUrl);

      const matchedHeaders = axiosConfig.headers;

      // Transmission headers should be stripped
      expect(matchedHeaders["content-length"]).toBeUndefined();
      expect(matchedHeaders["content-encoding"]).toBeUndefined();
      expect(matchedHeaders["connection"]).toBeUndefined();

      // Host should be overridden
      expect(matchedHeaders["host"]).toBe("example.com");

      // Masked headers should be stripped
      expect(matchedHeaders["authorization"]).toBeUndefined();

      // Response warning should be present
      expect(res.headers["x-apify-replay-warning"]).toMatch(/Headers stripped/);
      expect(res.body.strippedHeaders).toContain("content-length");
      expect(res.body.strippedHeaders).toContain("authorization");
    });
  });
});
