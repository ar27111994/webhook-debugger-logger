import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

/**
 * @typedef {import('../../src/typedefs.js').LogEntry} LogEntry
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 */

import { assertType } from "../setup/helpers/test-utils.js";

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup, useDbHooks } from "../setup/helpers/test-lifecycle.js";
await setupCommonMocks({ apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");
const { createDatasetMock } = await import("../setup/helpers/shared-mocks.js");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");

const createMockLog = (overrides = {}) => ({
  id: "log_" + Math.random().toString(36).substr(2, 9),
  webhookId: "wh_1",
  method: "POST",
  headers: {},
  body: "{}",
  query: {},
  contentType: "application/json",
  size: 2,
  statusCode: 200,
  processingTime: 10,
  timestamp: new Date().toISOString(),
  requestId: "req_" + Math.random().toString(36).substr(2, 9),
  remoteIp: "127.0.0.1",
  ...overrides,
});
const authKey = "TEST_KEY";
const authHeader = `Bearer ${authKey}`;

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../setup/helpers/app-utils.js").App} App
 */

describe("Log Filtering Routes", () => {
  useMockCleanup();
  useDbHooks();

  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {App} */
  let _app;

  beforeAll(async () => {
    // Enforce auth to test 401 scenarios
    jest.mocked(Actor.getInput).mockResolvedValue({ authKey });
    ({ app: _app, appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  describe("Root Route Content Negotiation", () => {
    test("GET / should return 200 OK for readiness probe", async () => {
      const res = await appClient
        .get("/")
        .set("X-Apify-Container-Server-Readiness-Probe", "1");
      expect(res.statusCode).toBe(200);
      expect(res.text).toBe("OK");
    });

    test("GET / should return 401 HTML for browser without auth", async () => {
      // Ensure we don't send auth headers
      const res = await appClient.get("/").set("Accept", "text/html");

      expect(res.statusCode).toBe(401);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("Access Restricted");
      expect(res.text).toContain("Strict Mode enabled");
    });

    test("GET / should return 401 JSON for non-browser without auth", async () => {
      const res = await appClient.get("/").set("Accept", "application/json");

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    test("GET / should return 200 HTML with Dashboard loop for valid auth", async () => {
      const res = await appClient
        .get("/")
        .set("Accept", "text/html")
        .set("Authorization", authHeader);

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain("Webhook Debugger");
      expect(res.text).toContain("Enterprise Suite");
      expect(res.text).toMatch(/\d+ active endpoints/);
    });
  });

  test("GET /logs should filter by method, status, contentType", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      createMockLog({
        id: "log_filter_1",
        webhookId: "wh_1",
        method: "POST",
        statusCode: 200,
        headers: { "content-type": "application/json" },
        timestamp: "2023-01-01T10:00:00Z",
      }),
      createMockLog({
        id: "log_filter_2",
        webhookId: "wh_1",
        method: "GET",
        statusCode: 404,
        headers: { "content-type": "text/plain" },
        contentType: "text/plain",
        timestamp: "2023-01-01T10:01:00Z",
      }),
      createMockLog({
        id: "log_filter_3",
        webhookId: "wh_2",
        method: "POST",
        statusCode: 200,
        headers: { "content-type": "application/json" },
        timestamp: "2023-01-01T10:02:00Z",
      }),
    ]);

    jest.spyOn(webhookManager, "isValid").mockReturnValue(true);
    jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock(items));
    await logRepository.batchInsertLogs(items);

    // Filter by Method
    let res = await appClient
      .get("/logs")
      .query({ method: "GET" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].method).toBe("GET");

    // Filter by StatusCode
    res = await appClient
      .get("/logs")
      .query({ statusCode: "404" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].statusCode).toBe(404);

    // Filter by ContentType
    res = await appClient
      .get("/logs")
      .query({ contentType: "text/plain" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].headers["content-type"]).toBe("text/plain");

    // Filter by WebhookId
    res = await appClient
      .get("/logs")
      .query({ webhookId: "wh_2" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].webhookId).toBe("wh_2");

    // Combined Filters
    res = await appClient
      .get("/logs")
      .query({ method: "POST", statusCode: 200 })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(2);
    res.body.items.forEach((/** @type {WebhookEvent} */ item) => {
      expect(item.method).toBe("POST");
      expect(item.statusCode).toBe(200);
    });

    // Invalid Webhook ID
    res = await appClient
      .get("/logs")
      .query({ webhookId: "non_existent" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(0);
  });

  test("GET /logs handles dataset errors gracefully", async () => {
    jest
      .spyOn(logRepository, "findLogs")
      .mockRejectedValue(new Error("Database access failed"));

    const res = await appClient.get("/logs").set("Authorization", authHeader);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Logs failed");
  });

  test("GET /logs handles limit edge cases", async () => {
    /** @type {LogEntry[]} */
    const items = new Array(5).fill(0).map((_, i) =>
      assertType(
        createMockLog({
          id: `limit_log_${i}`,
          webhookId: "wh_1",
          timestamp: new Date().toISOString(),
        }),
      ),
    );
    jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock(items));
    await logRepository.batchInsertLogs(items);

    // Case 1: Limit 0 (Should return default or handle gracefully, assuming default 100)
    let res = await appClient
      .get("/logs")
      .query({ limit: 0 })
      .set("Authorization", authHeader);
    expect(res.statusCode).toBe(200);
    // Our logic often defaults invalid/zero limit to DEFAULT_PAGINATION_LIMIT (100)
    expect(res.body.items.length).toBeGreaterThan(0);

    // Case 2: Negative Limit (Should be ignored or clamped)
    res = await appClient
      .get("/logs")
      .query({ limit: -10 })
      .set("Authorization", authHeader);
    expect(res.statusCode).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);

    // Case 3: Non-numeric Limit (Should use default)
    res = await appClient
      .get("/logs")
      .query({ limit: "invalid" })
      .set("Authorization", authHeader);
    expect(res.statusCode).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  test("GET /logs handles pagination limits", async () => {
    /** @type {LogEntry[]} */
    const items = new Array(50).fill(0).map((_, _i) =>
      assertType(
        createMockLog({
          id: `log_${_i}`,
          webhookId: "wh_1",
          timestamp: new Date().toISOString(),
        }),
      ),
    );

    const mockDataset = createDatasetMock(items);
    jest.mocked(Actor.openDataset).mockResolvedValue(assertType(mockDataset));
    await logRepository.batchInsertLogs(items);

    const res = await appClient
      .get("/logs")
      .query({ limit: 10 })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(10);
    expect(res.body.count).toBe(10);
  }, 30000);

  describe("GET /logs/:logId", () => {
    test("should return full log entry when no fields specified", async () => {
      /** @type {LogEntry} */
      const item = assertType({
        id: "log_1",
        webhookId: "wh_1",
        method: "POST",
        statusCode: 200,
        timestamp: new Date().toISOString(),
      });
      jest.spyOn(logRepository, "getLogById").mockResolvedValue(item);
      jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

      const res = await appClient
        .get("/logs/log_1")
        .set("Authorization", authHeader);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(item);
    });

    test("should return partial log entry when fields specified", async () => {
      /** @type {LogEntry} */
      const item = assertType({
        id: "log_2",
        webhookId: "wh_1",
        method: "GET",
        statusCode: 404,
      });

      jest.spyOn(logRepository, "getLogById").mockResolvedValue(item);
      jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

      const res = await appClient
        .get("/logs/log_2")
        .query({ fields: "method,statusCode" })
        .set("Authorization", authHeader);

      expect(res.statusCode).toBe(200);
      expect(logRepository.getLogById).toHaveBeenCalledWith(
        "log_2",
        expect.arrayContaining(["method", "statusCode", "webhookId"]),
      );
    });

    test("should strip webhookId if not requested but fetched for security", async () => {
      /** @type {LogEntry} */
      const item = assertType({
        id: "log_3",
        webhookId: "wh_1",
        method: "POST",
      });
      jest.spyOn(logRepository, "getLogById").mockResolvedValue(item);
      jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

      const res = await appClient
        .get("/logs/log_3")
        .query({ fields: "method" })
        .set("Authorization", authHeader);

      expect(res.statusCode).toBe(200);
      expect(res.body.webhookId).toBeUndefined();
      expect(res.body.method).toBe("POST");
    });
  });
});
