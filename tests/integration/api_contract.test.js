import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import('../setup/helpers/shared-mocks.js').AxiosMock} AxiosMock
 * @typedef {import('../setup/helpers/app-utils.js').AppClient} AppClient
 * @typedef {import('../setup/helpers/app-utils.js').TeardownApp} TeardownApp
 * @typedef {import('../setup/helpers/app-utils.js').App} App
 * @typedef {import('../../src/typedefs.js').LogEntry} LogEntry
 */

import { assertType, getLastAxiosConfig } from "../setup/helpers/test-utils.js";

// Mock Apify and axios using shared components
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, dns: true, ssrf: true });

const { resetNetworkMocks } = await import("../setup/helpers/shared-mocks.js");

import { createRequire } from "module";
import {
  APP_CONSTS,
  HTTP_STATUS,
  REPLAY_STATUS_LABELS,
  HTTP_HEADERS,
  MIME_TYPES,
  HTTP_METHODS,
} from "../../src/consts/index.js";
const { APIFY_HOMEPAGE_URL } = APP_CONSTS;

const require = createRequire(import.meta.url);
const { version } = require("../../package.json");

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { Actor } = await import("apify");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");

describe("API Contract & Regression Tests", () => {
  /** @type {string} */
  let webhookId;
  let webhookManager;

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
    const { webhookManager: wm } = await import("../../src/main.js");
    webhookManager = wm;
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
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer test-secret");

      expect(res.statusCode).toBe(HTTP_STATUS.OK);
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
      expect(body.docs).toBe(APIFY_HOMEPAGE_URL);
    });
  });

  describe("/logs Route Contract", () => {
    test("should echo back applied filters and correctly filter items", async () => {
      const mockItems = [
        {
          id: "log_2",
          contentType: MIME_TYPES.JSON,
          processingTime: 10,
          remoteIp: "127.0.0.1",
          webhookId,
          method: HTTP_METHODS.POST,
          statusCode: HTTP_STATUS.CREATED,
          timestamp: new Date().toISOString(),
          headers: {},
          query: {},
          body: {},
          size: 0,
        },
        {
          webhookId,
          method: HTTP_METHODS.GET,
          id: "log_1",
          contentType: MIME_TYPES.JSON,
          processingTime: 10,
          remoteIp: "127.0.0.1",
          statusCode: HTTP_STATUS.OK,
          timestamp: new Date().toISOString(),
          headers: {},
          query: {},
          body: {},
          size: 0,
        },
      ];

      await logRepository.batchInsertLogs(mockItems);

      const res = await appClient
        .get("/logs")
        .query({
          webhookId,
          method: HTTP_METHODS.POST,
          statusCode: "HTTP_STATUS.CREATED",
        })
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer test-secret");

      expect(res.statusCode).toBe(HTTP_STATUS.OK);
      expect(res.body.filters.method).toBe(HTTP_METHODS.POST);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].method).toBe(HTTP_METHODS.POST);
      expect(res.body.items[0].statusCode).toBe(HTTP_STATUS.CREATED);
    });
  });

  describe("Global Error Handler Contract", () => {
    test("should return HTTP_STATUS.BAD_REQUEST Bad Request status and title for unidentifiable IP", async () => {
      const res = await appClient.get("/info").set("x-simulate-no-ip", "true");

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe("Bad Request");
    });
  });

  describe("/replay Header Stripping", () => {
    test("should strip transmission-specific headers and provide warning", async () => {
      // Mock dataset to return an item with "forbidden" headers
      /**
       * @type {LogEntry}
       */
      const mockItem = assertType({
        id: "evt_strip",
        webhookId,
        method: HTTP_METHODS.POST,
        body: "{}",
        headers: {
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          [HTTP_HEADERS.KEEP_ALIVE]: "timeout=5",
          [HTTP_HEADERS.UPGRADE]: "websocket",
          [HTTP_HEADERS.HOST]: "local",
          [HTTP_HEADERS.AUTHORIZATION]: "[MASKED]", // Masked ones should also be stripped
        },
        timestamp: new Date().toISOString(),
        query: {},
        size: 2,
      });

      await logRepository.insertLog(mockItem);

      const res = await appClient
        .get(`/replay/${webhookId}/evt_strip`)
        .query({ url: "http://target.com" })
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer test-secret");

      expect(res.statusCode).toBe(HTTP_STATUS.OK);
      expect(res.body.status).toBe(REPLAY_STATUS_LABELS.REPLAYED);
      expect(res.body.targetUrl).toBe("http://target.com");
      expect(res.body.targetResponseBody).toBeDefined();
      expect(
        res.headers[HTTP_HEADERS.APIFY_REPLAY_WARNING.toLowerCase()],
      ).toMatch(/Headers stripped/);
      expect(
        res.headers[HTTP_HEADERS.APIFY_REPLAY_WARNING.toLowerCase()],
      ).toContain("keep-alive");
      expect(
        res.headers[HTTP_HEADERS.APIFY_REPLAY_WARNING.toLowerCase()],
      ).toContain("upgrade");
      expect(
        res.headers[HTTP_HEADERS.APIFY_REPLAY_WARNING.toLowerCase()],
      ).toContain("authorization");
    });

    test("should prioritize exact ID match over timestamp match when both exist", async () => {
      const timestamp = new Date().toISOString();
      /**
       * @type {LogEntry[]}
       */
      const mockItems = assertType([
        {
          id: "evt_duplicate_timestamp",
          webhookId,
          method: HTTP_METHODS.POST,
          body: '{"msg": "i am the correct one"}',
          timestamp,
          headers: {},
          query: {},
          size: 10,
          contentType: MIME_TYPES.JSON,
          remoteIp: "127.0.0.1",
          processingTime: 5,
        },
        {
          id: "evt_collided",
          webhookId,
          method: HTTP_METHODS.POST,
          body: '{"msg": "i am an interloper with same timestamp"}',
          timestamp,
          headers: {},
          query: {},
          size: 10,
          contentType: MIME_TYPES.JSON,
          remoteIp: "127.0.0.1",
          processingTime: 5,
        },
      ]);

      await logRepository.batchInsertLogs(mockItems);

      const { default: axiosMock } = await import("axios");
      /** @type {AxiosMock} */ (axiosMock).mockClear();

      // We request the FIRST one by its ID
      const res = await appClient
        .get(`/replay/${webhookId}/evt_duplicate_timestamp`)
        .query({ url: "http://target.com" })
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer test-secret");

      expect(res.statusCode).toBe(HTTP_STATUS.OK);

      const lastCallConfig = getLastAxiosConfig(axiosMock, null);
      if (!lastCallConfig || !lastCallConfig.data)
        throw new Error("No axios call found");
      expect(lastCallConfig.data).toContain("i am the correct one");

      // We request the SECOND one by its ID (this would fail if we matched purely by timestamp first)
      const res2 = await appClient
        .get(`/replay/${webhookId}/evt_collided`)
        .query({ url: "http://target.com" })
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer test-secret");

      expect(res2.statusCode).toBe(HTTP_STATUS.OK);

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
        method: HTTP_METHODS.POST,
        body: "{}",
        timestamp: new Date().toISOString(),
        headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
        query: {},
        size: 2,
        contentType: MIME_TYPES.JSON,
        remoteIp: "127.0.0.1",
        processingTime: 5,
        statusCode: HTTP_STATUS.OK,
      };
      await logRepository.insertLog(mockItem);

      const { default: axiosMock } = await import("axios");
      /** @type {AxiosMock} */ (axiosMock).mockClear().mockRejectedValue({
        code: "ETIMEDOUT",
        message: "Connect timeout",
      });

      const res = await appClient
        .get(`/replay/${webhookId}/evt_timeout`)
        .query({ url: "http://timeout.com" })
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer test-secret");

      expect(res.statusCode).toBe(HTTP_STATUS.GATEWAY_TIMEOUT);
      expect(res.body.error).toBe("Replay Failed");
      expect(res.body.message).toContain("Target destination timed out");

      expect(axiosMock).toHaveBeenCalledTimes(3);
    });
  });
});
