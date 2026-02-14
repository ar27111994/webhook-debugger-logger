import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  createDatasetMock,
  createMockWebhookManager,
} from "../setup/helpers/shared-mocks.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { resetDb } from "../setup/helpers/db-hooks.js";
import { constsMock } from "../setup/helpers/shared-mocks.js";

// Initialize mocks BEFORE imports
await setupCommonMocks({ apify: true, axios: false });

const { createLogsHandler } = await import("../../src/routes/logs.js");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/webhook_manager.js").WebhookManager} WebhookManager
 * @typedef {import("../../src/typedefs.js").WebhookEvent} WebhookEvent
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 */

describe("Log Sorting Logic", () => {
  // Auto-cleanup mocks
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;
  /** @type {WebhookManager} */
  let mockWebhookManager;

  /** @type {LogEntry[]} */
  const mockItems = assertType([
    {
      id: "item1",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:00Z",
      statusCode: constsMock.HTTP_STATUS.OK,
      processingTime: 100,
      method: "GET",
      requestId: "REQ-A",
      remoteIp: "10.0.0.1",
    },
    {
      id: "item2",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:02Z",
      statusCode: constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
      processingTime: 50,
      method: "POST",
      requestId: "REQ-C",
      remoteIp: "192.168.1.1",
    },
    {
      id: "item3",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:01Z",
      statusCode: constsMock.HTTP_STATUS.NOT_FOUND,
      processingTime: 200,
      method: "PUT",
      requestId: "REQ-B",
      remoteIp: "127.0.0.1",
    },
  ]);

  beforeEach(async () => {
    // 1. Reset DB
    await resetDb();

    // 2. Populate DB
    for (const item of mockItems) {
      await logRepository.insertLog(item);
    }

    // 3. Setup Dataset Mock (Write Model)
    createDatasetMock([...mockItems], { autoRegister: true });

    // Setup WebhookManager Mock
    mockWebhookManager = createMockWebhookManager();
    jest.mocked(mockWebhookManager.isValid).mockReturnValue(true);

    // Setup Request/Response
    res = createMockResponse();
    next = createMockNextFunction();
  });

  const getHandler = () => createLogsHandler(mockWebhookManager);

  it("should sort by timestamp desc by default", async () => {
    req = createMockRequest({ query: {} });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["item2", "item3", "item1"]); // Newest first
  });

  it("should sort by timestamp asc", async () => {
    req = createMockRequest({ query: { sort: "timestamp:asc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["item1", "item3", "item2"]); // Oldest first
  });

  it("should sort by statusCode desc", async () => {
    req = createMockRequest({ query: { sort: "statusCode:desc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const codes = response.items.map(
      (/** @type {WebhookEvent} */ i) => i.statusCode,
    );
    expect(codes).toEqual([
      constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
      constsMock.HTTP_STATUS.NOT_FOUND,
      constsMock.HTTP_STATUS.OK,
    ]);
  });

  it("should sort by processingTime desc", async () => {
    req = createMockRequest({ query: { sort: "processingTime:desc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const times = response.items.map(
      (/** @type {WebhookEvent} */ i) => i.processingTime,
    );
    expect(times).toEqual([200, 100, 50]);
  });

  it("should sort by remoteIp asc", async () => {
    req = createMockRequest({ query: { sort: "remoteIp:asc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ips = response.items.map(
      (/** @type {WebhookEvent} */ i) => i.remoteIp,
    );
    expect(ips).toEqual(["10.0.0.1", "127.0.0.1", "192.168.1.1"]);
  });

  it("should sort by requestId desc", async () => {
    req = createMockRequest({ query: { sort: "requestId:desc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const rids = response.items.map(
      (/** @type {WebhookEvent} */ i) => i.requestId,
    );
    expect(rids).toEqual(["REQ-C", "REQ-B", "REQ-A"]);
  });

  it("should fallback to timestamp if invalid field provided", async () => {
    req = createMockRequest({ query: { sort: "invalidField:asc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["item2", "item3", "item1"]);
  });

  it("should sort by multiple fields", async () => {
    /** @type {LogEntry[]} */
    const multiItems = assertType([
      {
        id: "A",
        statusCode: constsMock.HTTP_STATUS.OK,
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        statusCode: constsMock.HTTP_STATUS.OK,
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
      {
        id: "C",
        statusCode: constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
        timestamp: "2023-01-01T10:00:01Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(multiItems, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(multiItems);
    await resetDb();
    await logRepository.batchInsertLogs(multiItems);

    req = createMockRequest({
      query: { sort: "statusCode:asc,timestamp:desc" },
    });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["B", "A", "C"]);
  });

  it("should filter by headers (string match)", async () => {
    /** @type {LogEntry[]} */
    const headerItems = assertType([
      {
        id: "item1",
        webhookId: "wh_1",
        headers: { "x-foo": "bar" },
        timestamp: "2023-01-01T10:00:00Z",
      },
      {
        id: "item2",
        webhookId: "wh_1",
        headers: { "x-abc": "xyz" },
        timestamp: "2023-01-01T10:00:02Z",
      },
      {
        id: "item3",
        webhookId: "wh_1",
        headers: { "x-foo": "baz" },
        timestamp: "2023-01-01T10:00:01Z",
      },
    ]);
    createDatasetMock(headerItems, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(headerItems);

    req = createMockRequest({ query: { headers: "x-foo" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["item3", "item1"]);
  });

  it("should filter by headers (object match)", async () => {
    /** @type {LogEntry[]} */
    const headerItems = assertType([
      {
        id: "item1",
        webhookId: "wh_1",
        headers: { "content-type": "application/json", "x-id": "1" },
        timestamp: "2023-01-01T10:00:00Z",
      },
      {
        id: "item2",
        webhookId: "wh_1",
        headers: { "content-type": "text/html", "x-id": "2" },
        timestamp: "2023-01-01T10:00:02Z",
      },
      {
        id: "item3",
        webhookId: "wh_1",
        headers: { "content-type": "application/json", "x-id": "3" },
        timestamp: "2023-01-01T10:00:01Z",
      },
    ]);
    createDatasetMock(headerItems, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(headerItems);

    req = createMockRequest({
      query: {
        headers: { "content-type": "json" },
      },
    });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["item3", "item1"]);
  });

  it("should sort by size desc", async () => {
    /** @type {LogEntry[]} */
    const sizeItems = assertType([
      {
        id: "A",
        size: 100,
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        size: 50,
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
      {
        id: "C",
        size: 200,
        timestamp: "2023-01-01T10:00:01Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(sizeItems, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(sizeItems);

    req = createMockRequest({ query: { sort: "size:desc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["C", "A", "B"]);
  });

  it("should filter by size (exact match)", async () => {
    /** @type {LogEntry[]} */
    const sizeItems = assertType([
      {
        id: "A",
        size: 100,
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        size: 200,
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(sizeItems, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(sizeItems);

    req = createMockRequest({ query: { size: "100" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should filter by query (string match)", async () => {
    /** @type {LogEntry[]} */
    const queryItems = assertType([
      {
        id: "A",
        query: { foo: "bar" },
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        query: { baz: "qux" },
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(queryItems, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(queryItems);

    req = createMockRequest({ query: { query: "foo" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should filter by query (object match)", async () => {
    /** @type {LogEntry[]} */
    const queryItems = assertType([
      {
        id: "A",
        query: { status: "success", retries: "3" },
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        query: { status: "failed", retries: "1" },
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(queryItems, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(queryItems);

    req = createMockRequest({ query: { query: { status: "fail" } } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["B"]);
  });

  it("should ignore sort by query and fallback to timestamp", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      { id: "A", timestamp: "2023-01-01T10:00:00Z", webhookId: "wh_1" },
      { id: "B", timestamp: "2023-01-01T10:00:02Z", webhookId: "wh_1" },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({ query: { sort: "query:desc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    // Fallback is timestamp:desc (Newest first)
    expect(ids).toEqual(["B", "A"]);
  });

  it("should filter by responseBody (partial string match)", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        responseBody: '{"success":true}',
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        responseBody: "Simple Validation Error",
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({
      query: { responseBody: "validation" },
    });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["B"]);
  });

  it("should filter by responseHeaders (object match)", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        responseHeaders: { "x-custom": "123" },
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        responseHeaders: { "x-custom": "456" },
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({
      query: { responseHeaders: { "x-custom": "123" } },
    });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should filter by signatureProvider", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        signatureProvider: "stripe",
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        signatureProvider: "github",
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({
      query: { signatureProvider: "stripe" },
    });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should filter by signatureError (partial string match)", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        signatureError: "Signature mismatch",
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        signatureError: "Missing header",
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({
      query: { signatureError: "mismatch" },
    });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should ignore sort by responseHeaders and fallback to timestamp", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
        responseHeaders: { a: "1" },
      },
      {
        id: "B",
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
        responseHeaders: { b: "2" },
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({ query: { sort: "responseHeaders:desc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    // Fallback is timestamp:desc (Newest first)
    expect(ids).toEqual(["B", "A"]);
  });

  it("should filter by body (string match)", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        body: "some text content",
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        body: "other data",
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({ query: { body: "text" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should filter by body (object/json match)", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        body: { foo: "bar" },
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        body: { foo: "baz" },
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({ query: { body: "bar" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should ignore sort by body/responseBody", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
        body: "z",
        responseBody: "a",
      },
      {
        id: "B",
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
        body: "a",
        responseBody: "z",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({ query: { sort: "body:asc,responseBody:asc" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    // Should fallback to timestamp:desc because body/responseBody are excluded
    expect(ids).toEqual(["B", "A"]);
  });

  it("should filter by body (raw json string match)", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        body: '{"foo":"bar"}', // Raw JSON string
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        body: '{"foo":"baz"}',
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    // Searching for text that includes quotes to ensure no double-escaping logic mangles it
    req = createMockRequest({ query: { body: '"foo":"bar"' } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });

  it("should filter by userAgent (partial string match)", async () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        userAgent: "Mozilla/5.0 (Windows NT 10.0)",
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        userAgent: "curl/7.68.0",
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
    ]);
    createDatasetMock(items, { autoRegister: true });
    await resetDb();
    await logRepository.batchInsertLogs(items);

    req = createMockRequest({ query: { userAgent: "windows" } });
    await getHandler()(req, res, next);

    const response = jest.mocked(res.json).mock.calls[0][0];
    const ids = response.items.map((/** @type {WebhookEvent} */ i) => i.id);
    expect(ids).toEqual(["A"]);
  });
});
