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
import { logRepository } from "../../src/repositories/LogRepository.js";
import {
  HTTP_STATUS,
  HTTP_HEADERS,
  MIME_TYPES,
} from "../../src/consts/index.js";

describe("Production Readiness Tests (v2.6.0)", () => {
  /** @type {string} */
  let webhookId;

  useMockCleanup();

  beforeAll(async () => {
    jest.setTimeout(15000);
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
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer top-secret")
        .set(HTTP_HEADERS.X_FORWARDED_FOR, testIp)
        .expect(HTTP_STATUS.OK);
      // 2nd request - Success
      await agent
        .get("/info")
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer top-secret")
        .set(HTTP_HEADERS.X_FORWARDED_FOR, testIp)
        .expect(HTTP_STATUS.OK);
      // 3rd request - Failure (Rate Limit Exceeded)
      const res = await agent
        .get("/info")
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer top-secret")
        .set(HTTP_HEADERS.X_FORWARDED_FOR, testIp);
      expect(res.statusCode).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    });
  });

  describe("Security: Data Masking", () => {
    test("Sensitive headers should be masked in logs", async () => {
      const agent = request(app);

      await agent
        .post(`/webhook/${webhookId}`)
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer top-secret") // Use the correct key
        .set(HTTP_HEADERS.COOKIE, "session=123")
        .set(HTTP_HEADERS.X_API_KEY, "my-key")
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
      expect(matchedCall?.headers?.[HTTP_HEADERS.AUTHORIZATION]).toBe(
        "[MASKED]",
      );
      expect(matchedCall?.headers?.[HTTP_HEADERS.COOKIE]).toBe("[MASKED]");
      expect(matchedCall?.headers?.[HTTP_HEADERS.X_API_KEY]).toBe("[MASKED]");
      expect(matchedCall?.headers?.[HTTP_HEADERS.HOST]).toBeDefined();
    });
  });

  describe("Security: CIDR IP Whitelisting", () => {
    test("Should allow IP within CIDR range", async () => {
      const res = await request(app)
        .post(`/webhook/${webhookId}`)
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer top-secret")
        .set(HTTP_HEADERS.X_FORWARDED_FOR, "192.168.1.50")
        .send({});
      expect(res.statusCode).toBe(HTTP_STATUS.OK);
    });

    test("Should reject IP outside CIDR range", async () => {
      const res = await request(app)
        .post(`/webhook/${webhookId}`)
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer top-secret")
        .set(HTTP_HEADERS.X_FORWARDED_FOR, "8.8.8.8")
        .send({});
      expect(res.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
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
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          [HTTP_HEADERS.CONTENT_LENGTH]: "10", // Obviously too small for the body below
          [HTTP_HEADERS.AUTHORIZATION]: "[MASKED]",
          [HTTP_HEADERS.HOST]: "original.com",
          [HTTP_HEADERS.CONNECTION]: "keep-alive",
        },
        body: '{\n  "hello": "world"\n}', // 22 characters
      };

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock([mockEvent]));

      // Insert into DuckDB because Replay relies on hot storage (Deep Search via Dataset is not enabled)
      await logRepository.insertLog({
        ...mockEvent,
        timestamp: new Date().toISOString(),
        requestId: "req_test",
        remoteIp: "127.0.0.1",
        query: {},
        contentType: MIME_TYPES.JSON,
        size: mockEvent.body.length,
        statusCode: HTTP_STATUS.OK,
        processingTime: 10,
      });

      const res = await request(app)
        .post(`/replay/${webhookId}/${eventId}?url=${targetUrl}`)
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer top-secret")
        .expect(HTTP_STATUS.OK);

      const { default: axiosMock } = await import("axios");
      const axiosConfig = getLastAxiosConfig(axiosMock, null);

      expect(axiosConfig).toBeDefined();
      expect(axiosConfig.url).toBe(targetUrl);

      const matchedHeaders = axiosConfig.headers;

      // Transmission headers should be stripped
      expect(matchedHeaders[HTTP_HEADERS.CONTENT_LENGTH]).toBeUndefined();
      expect(matchedHeaders[HTTP_HEADERS.CONTENT_ENCODING]).toBeUndefined();
      expect(matchedHeaders[HTTP_HEADERS.CONNECTION]).toBeUndefined();

      // Host should be overridden
      expect(matchedHeaders[HTTP_HEADERS.HOST]).toBe("example.com");
      expect(matchedHeaders[HTTP_HEADERS.AUTHORIZATION]).toBeUndefined();

      // Response warning should be present
      expect(
        res.headers[HTTP_HEADERS.APIFY_REPLAY_WARNING.toLowerCase()],
      ).toMatch(/Headers stripped/);
      expect(res.body.strippedHeaders).toContain(HTTP_HEADERS.CONTENT_LENGTH);
      expect(res.body.strippedHeaders).toContain(HTTP_HEADERS.AUTHORIZATION);
    });
  });
});
