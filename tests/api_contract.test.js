import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

// Mock Apify and axios using shared components
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const request = (await import("supertest")).default;
const { app, initialize, shutdown, webhookManager } =
  await import("../src/main.js");
const { Actor } = await import("apify");

describe("API Contract & Regression Tests", () => {
  /** @type {string} */
  let webhookId;

  beforeAll(async () => {
    jest.mocked(Actor.getInput).mockResolvedValue({ authKey: "test-secret" });
    await initialize();
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  describe("/info Route Contract", () => {
    test("should return ALL required metadata fields", async () => {
      const res = await request(app)
        .get("/info")
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(200);
      const body = res.body;

      // Top-level
      expect(body.version).toBe(version);
      expect(body.status).toBe("Enterprise Suite Online");

      // System block
      expect(body.system).toBeDefined();
      expect(body.system.authActive).toBe(true);
      const activeIds = body.system.activeWebhooks.map(
        (/** @type {{id: string}} */ w) => w.id,
      );
      expect(activeIds).toContain(webhookId);
      expect(body.system.webhookCount).toBeGreaterThanOrEqual(1);

      // Features block
      expect(body.features).toEqual(
        expect.arrayContaining([
          "Advanced Mocking & Latency Control",
          "Enterprise Security (Auth/CIDR)",
          "Smart Forwarding Workflows",
        ]),
      );

      // Endpoints block
      expect(body.endpoints).toBeDefined();
      expect(body.endpoints.logs).toMatch(/^http:\/\//);
      expect(body.endpoints.logs).toContain("/logs");
      expect(body.endpoints.replay).toMatch(/\/replay\/:webhookId\/:itemId/);

      // Docs
      expect(body.docs).toBe(
        "https://apify.com/ar27111994/webhook-debugger-logger",
      );
    });
  });

  describe("/logs Route Contract", () => {
    test("should echo back applied filters and correctly filter items", async () => {
      const mockItems = [
        {
          webhookId,
          method: "POST",
          statusCode: 201,
          timestamp: new Date().toISOString(),
        },
        {
          webhookId,
          method: "GET",
          statusCode: 200,
          timestamp: new Date().toISOString(),
        },
      ];

      jest.mocked(Actor.openDataset).mockResolvedValue(
        /** @type {any} */ ({
          getData: jest.fn(async () => ({ items: mockItems })),
        }),
      );

      const res = await request(app)
        .get("/logs")
        .query({
          webhookId,
          method: "POST",
          statusCode: "201",
        })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(200);
      expect(res.body.filters.method).toBe("POST");
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].method).toBe("POST");
      expect(res.body.items[0].statusCode).toBe(201);
    });

    test("should fetch with limit * 5 when filters are present", async () => {
      const getDataMock = jest.fn(async () => ({ items: [] }));
      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(/** @type {any} */ ({ getData: getDataMock }));

      await request(app)
        .get("/logs")
        .query({ method: "POST", limit: 10 })
        .set("Authorization", "Bearer test-secret");

      expect(getDataMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    test("should fetch with limit * 1 when NO filters are present", async () => {
      const getDataMock = jest.fn(async () => ({ items: [] }));
      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(/** @type {any} */ ({ getData: getDataMock }));

      await request(app)
        .get("/logs")
        .query({ limit: 10 })
        .set("Authorization", "Bearer test-secret");

      expect(getDataMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });
  });

  describe("Global Error Handler Contract", () => {
    test("should return 400 Bad Request status and title for unidentifiable IP", async () => {
      const res = await request(app)
        .get("/info")
        .set("x-simulate-no-ip", "true");

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe(400);
      expect(res.body.error).toBe("Bad Request");
    });
  });

  describe("/replay Header Stripping", () => {
    test("should strip transmission-specific headers and provide warning", async () => {
      // Mock dataset to return an item with "forbidden" headers
      const mockItem = {
        id: "evt_strip",
        webhookId,
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "keep-alive": "timeout=5",
          upgrade: "websocket",
          host: "local",
          authorization: "[MASKED]", // Masked ones should also be stripped
        },
      };

      jest.mocked(Actor.openDataset).mockResolvedValue(
        /** @type {any} */ ({
          getData: jest.fn(async () => ({ items: [mockItem] })),
        }),
      );

      const res = await request(app)
        .get(`/replay/${webhookId}/evt_strip`)
        .query({ url: "http://target.com" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("Replayed");
      expect(res.body.targetUrl).toBe("http://target.com");
      expect(res.body.targetResponseBody).toBeDefined();
      expect(res.headers["x-apify-replay-warning"]).toMatch(/Headers stripped/);
      expect(res.headers["x-apify-replay-warning"]).toContain("keep-alive");
      expect(res.headers["x-apify-replay-warning"]).toContain("upgrade");
      expect(res.headers["x-apify-replay-warning"]).toContain("authorization");
    });

    test("should prioritize exact ID match over timestamp match when both exist", async () => {
      const timestamp = new Date().toISOString();
      const mockItems = [
        {
          id: "evt_duplicate_timestamp",
          webhookId,
          method: "POST",
          body: '{"msg": "i am the correct one"}',
          timestamp,
        },
        {
          id: "evt_collided",
          webhookId,
          method: "POST",
          body: '{"msg": "i am an interloper with same timestamp"}',
          timestamp,
        },
      ];

      jest.mocked(Actor.openDataset).mockResolvedValue(
        /** @type {any} */ ({
          getData: jest.fn(async () => ({ items: mockItems })),
        }),
      );

      // We request the FIRST one by its ID
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_duplicate_timestamp`)
        .query({ url: "http://target.com" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(200);
      const { default: axiosMock } = await import("axios");
      const axiosCalls = /** @type {any} */ (axiosMock).mock.calls;
      const lastCall = axiosCalls[axiosCalls.length - 1];
      expect(lastCall[0].data).toContain("i am the correct one");

      // We request the SECOND one by its ID (this would fail if we matched purely by timestamp first)
      const res2 = await request(app)
        .get(`/replay/${webhookId}/evt_collided`)
        .query({ url: "http://target.com" })
        .set("Authorization", "Bearer test-secret");

      expect(res2.statusCode).toBe(200);
      const lastCall2 = axiosCalls[axiosCalls.length - 1];
      expect(lastCall2[0].data).toContain(
        "i am an interloper with same timestamp",
      );
    });
  });
});
