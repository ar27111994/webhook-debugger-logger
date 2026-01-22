import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { useMockCleanup } from "./helpers/test-lifecycle.js";

/**
 * @typedef {import('./helpers/shared-mocks.js').AxiosMock} AxiosMock
 * @typedef {import('./helpers/app-utils.js').AppClient} AppClient
 * @typedef {import('./helpers/app-utils.js').TeardownApp} TeardownApp
 * @typedef {import('./helpers/app-utils.js').App} App
 */

import { getLastAxiosConfig } from "./helpers/test-utils.js";

// Mock Apify and axios using shared components
import { setupCommonMocks } from "./helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, dns: true, ssrf: true });

const { createDatasetMock, resetNetworkMocks } =
  await import("./helpers/shared-mocks.js");

import { createRequire } from "module";
import { MAX_ITEMS_FOR_BATCH } from "../src/consts.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const { setupTestApp } = await import("./helpers/app-utils.js");
const { webhookManager } = await import("../src/main.js");
const { Actor } = await import("apify");

describe("API Contract & Regression Tests", () => {
  /** @type {string} */
  let webhookId;

  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {App} */
  let _app;

  useMockCleanup(async () => {
    await resetNetworkMocks();
  });

  beforeAll(async () => {
    jest.mocked(Actor.getInput).mockResolvedValue({ authKey: "test-secret" });
    ({ appClient, teardownApp, app: _app } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
  });

  describe("/info Route Contract", () => {
    test("should return ALL required metadata fields", async () => {
      const res = await appClient
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

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock(mockItems));

      const res = await appClient
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
      const datasetMock = createDatasetMock([]);
      const getDataMock = jest.spyOn(datasetMock, "getData");
      jest.mocked(Actor.openDataset).mockResolvedValue(datasetMock);

      await appClient
        .get("/logs")
        .query({ method: "POST", limit: 10 })
        .set("Authorization", "Bearer test-secret");

      expect(getDataMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: MAX_ITEMS_FOR_BATCH }),
      );
    });

    test("should fetch with limit * 1 when NO filters are present", async () => {
      const datasetMock = createDatasetMock([]);
      const getDataMock = jest.spyOn(datasetMock, "getData");
      jest.mocked(Actor.openDataset).mockResolvedValue(datasetMock);

      await appClient
        .get("/logs")
        .query({ limit: 10 })
        .set("Authorization", "Bearer test-secret");

      expect(getDataMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: MAX_ITEMS_FOR_BATCH }),
      );
    });
  });

  describe("Global Error Handler Contract", () => {
    test("should return 400 Bad Request status and title for unidentifiable IP", async () => {
      const res = await appClient.get("/info").set("x-simulate-no-ip", "true");

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

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock([mockItem]));

      const res = await appClient
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

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock(mockItems));

      const { default: axiosMock } = await import("axios");
      /** @type {AxiosMock} */ (axiosMock).mockClear();

      // We request the FIRST one by its ID
      const res = await appClient
        .get(`/replay/${webhookId}/evt_duplicate_timestamp`)
        .query({ url: "http://target.com" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(200);

      const lastCallConfig = getLastAxiosConfig(axiosMock, null);
      if (!lastCallConfig || !lastCallConfig.data)
        throw new Error("No axios call found");
      expect(lastCallConfig.data).toContain("i am the correct one");

      // We request the SECOND one by its ID (this would fail if we matched purely by timestamp first)
      const res2 = await appClient
        .get(`/replay/${webhookId}/evt_collided`)
        .query({ url: "http://target.com" })
        .set("Authorization", "Bearer test-secret");

      expect(res2.statusCode).toBe(200);

      const lastCallConfig2 = getLastAxiosConfig(axiosMock, null);
      if (!lastCallConfig2 || !lastCallConfig2.data)
        throw new Error("No axios call found");
      expect(lastCallConfig2.data).toContain(
        "i am an interloper with same timestamp",
      );
    });

    test("POST /replay should retry on ETIMEDOUT and fail gracefully", async () => {
      const mockItem = {
        id: "evt_timeout",
        webhookId,
        method: "POST",
        body: "{}",
      };
      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock([mockItem]));

      const { default: axiosMock } = await import("axios");
      /** @type {AxiosMock} */ (axiosMock).mockClear().mockRejectedValue({
        code: "ETIMEDOUT",
        message: "Connect timeout",
      });

      const res = await appClient
        .get(`/replay/${webhookId}/evt_timeout`)
        .query({ url: "http://timeout.com" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(504);
      expect(res.body.error).toBe("Replay failed");
      expect(res.body.message).toContain("Target destination timed out");

      expect(axiosMock).toHaveBeenCalledTimes(3);
    });
  });
});
