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
const {
  HTTP_STATUS,
  WEBHOOK_ID_PREFIX,
  REQUEST_ID_PREFIX,
  HTTP_HEADERS,
  MIME_TYPES,
  HTTP_METHODS,
  ENV_VARS,
} = await import("../../src/consts/index.js");

const createMockLog = (overrides = {}) => ({
  id: "log_" + Math.random().toString(36).substr(2, 9),
  webhookId: `${WEBHOOK_ID_PREFIX}1`,
  method: HTTP_METHODS.POST,
  headers: {},
  body: "{}",
  query: {},
  contentType: MIME_TYPES.JSON,
  size: 2,
  statusCode: HTTP_STATUS.OK,
  processingTime: 10,
  timestamp: new Date().toISOString(),
  requestId: `${REQUEST_ID_PREFIX}${Math.random().toString(36).substr(2, 9)}`,
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
    // Prevent INPUT env var from polluting tests (from main_lifecycle.test.js)
    delete process.env[ENV_VARS.INPUT];
    process.env[ENV_VARS.DISABLE_HOT_RELOAD] = "true";

    // Enforce auth to test 401 scenarios
    jest.mocked(Actor.getInput).mockResolvedValue({ authKey });
    ({ app: _app, appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  describe("Root Route Content Negotiation", () => {
    test("GET / should return HTTP_STATUS.OK OK for readiness probe", async () => {
      const res = await appClient
        .get("/")
        .set(HTTP_HEADERS.APIFY_READINESS, "1");
      expect(res.statusCode).toBe(HTTP_STATUS.OK);
      expect(res.text).toBe("OK");
    });

    test("GET / should return HTTP_STATUS.UNAUTHORIZED HTML for browser without auth", async () => {
      // Ensure we don't send auth headers
      const res = await appClient
        .get("/")
        .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.HTML);

      expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("401 Unauthorized");
    });

    test("GET / should return HTTP_STATUS.UNAUTHORIZED JSON for non-browser without auth", async () => {
      const res = await appClient
        .get("/")
        .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.JSON);

      expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(res.body.error).toBe("Unauthorized");
      expect(res.body.message).toBe("Unauthorized: Missing API key");
    });

    test("GET / should return HTTP_STATUS.OK HTML with Dashboard loop for valid auth", async () => {
      const res = await appClient
        .get("/")
        .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.HTML)
        .set(HTTP_HEADERS.AUTHORIZATION, authHeader);

      expect(res.statusCode).toBe(HTTP_STATUS.OK);
      expect(res.text).toContain(
        "Webhook Debugger, Logger & API Mocking Suite",
      );
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
        method: HTTP_METHODS.POST,
        statusCode: HTTP_STATUS.OK,
        headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
        timestamp: "2023-01-01T10:00:00Z",
      }),
      createMockLog({
        id: "log_filter_2",
        webhookId: "wh_1",
        method: HTTP_METHODS.GET,
        statusCode: HTTP_STATUS.NOT_FOUND,
        headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.TEXT },
        contentType: MIME_TYPES.TEXT,
        timestamp: "2023-01-01T10:01:00Z",
      }),
      createMockLog({
        id: "log_filter_3",
        webhookId: "wh_2",
        method: HTTP_METHODS.POST,
        statusCode: HTTP_STATUS.OK,
        headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
        timestamp: "2023-01-01T10:02:00Z",
      }),
    ]);

    jest.spyOn(webhookManager, "isValid").mockReturnValue(true);
    jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock(items));
    await logRepository.batchInsertLogs(items);

    // Filter by Method
    let res = await appClient
      .get("/logs")
      .query({ method: HTTP_METHODS.GET })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].method).toBe(HTTP_METHODS.GET);

    // Filter by StatusCode
    res = await appClient
      .get("/logs")
      .query({ statusCode: HTTP_STATUS.NOT_FOUND.toString() })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].statusCode).toBe(HTTP_STATUS.NOT_FOUND);

    // Filter by ContentType
    res = await appClient
      .get("/logs")
      .query({ contentType: MIME_TYPES.TEXT })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].headers[HTTP_HEADERS.CONTENT_TYPE]).toBe(
      MIME_TYPES.TEXT,
    );

    // Filter by WebhookId
    res = await appClient
      .get("/logs")
      .query({ webhookId: "wh_2" })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].webhookId).toBe("wh_2");

    // Combined Filters
    res = await appClient
      .get("/logs")
      .query({ method: HTTP_METHODS.POST, statusCode: HTTP_STATUS.OK })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.body.items).toHaveLength(2);
    res.body.items.forEach((/** @type {WebhookEvent} */ item) => {
      expect(item.method).toBe(HTTP_METHODS.POST);
      expect(item.statusCode).toBe(HTTP_STATUS.OK);
    });

    // Invalid Webhook ID
    res = await appClient
      .get("/logs")
      .query({ webhookId: "non_existent" })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.body.items).toHaveLength(0);
  });

  test("GET /logs handles dataset errors gracefully", async () => {
    jest
      .spyOn(logRepository, "findLogs")
      .mockRejectedValue(new Error("Database access failed"));

    const res = await appClient
      .get("/logs")
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);

    expect(res.statusCode).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(res.body.error).toBe("Logs Failed");
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
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    // Our logic often defaults invalid/zero limit to DEFAULT_PAGINATION_LIMIT (100)
    expect(res.body.items.length).toBeGreaterThan(0);

    // Case 2: Negative Limit (Should be ignored or clamped)
    res = await appClient
      .get("/logs")
      .query({ limit: -10 })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.items.length).toBeGreaterThan(0);

    // Case 3: Non-numeric Limit (Should use default)
    res = await appClient
      .get("/logs")
      .query({ limit: "invalid" })
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
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
      .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
    expect(res.body.items).toHaveLength(10);
    expect(res.body.count).toBe(10);
  }, 30000);

  describe("GET /logs/:logId", () => {
    test("should return full log entry when no fields specified", async () => {
      /** @type {LogEntry} */
      const item = assertType({
        id: "log_1",
        webhookId: "wh_1",
        method: HTTP_METHODS.POST,
        statusCode: HTTP_STATUS.OK,
        timestamp: new Date().toISOString(),
      });
      jest.spyOn(logRepository, "getLogById").mockResolvedValue(item);
      jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

      const res = await appClient
        .get("/logs/log_1")
        .set(HTTP_HEADERS.AUTHORIZATION, authHeader);
      expect(res.statusCode).toBe(HTTP_STATUS.OK);
      expect(res.body).toEqual(item);
    });

    test("should return partial log entry when fields specified", async () => {
      /** @type {LogEntry} */
      const item = assertType({
        id: "log_2",
        webhookId: "wh_1",
        method: HTTP_METHODS.GET,
        statusCode: HTTP_STATUS.NOT_FOUND,
      });

      jest.spyOn(logRepository, "getLogById").mockResolvedValue(item);
      jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

      const res = await appClient
        .get("/logs/log_2")
        .query({ fields: "method,statusCode" })
        .set(HTTP_HEADERS.AUTHORIZATION, authHeader);

      expect(res.statusCode).toBe(HTTP_STATUS.OK);
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
        method: HTTP_METHODS.POST,
      });
      jest.spyOn(logRepository, "getLogById").mockResolvedValue(item);
      jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

      const res = await appClient
        .get("/logs/log_3")
        .query({ fields: "method" })
        .set(HTTP_HEADERS.AUTHORIZATION, authHeader);

      expect(res.statusCode).toBe(HTTP_STATUS.OK);
      expect(res.body.webhookId).toBeUndefined();
      expect(res.body.method).toBe(HTTP_METHODS.POST);
    });
  });
});
