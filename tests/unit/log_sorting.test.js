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
} from "../setup/helpers/test-utils.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

// Initialize mocks BEFORE imports
await setupCommonMocks({ apify: true, axios: false });

const { createLogsHandler } = await import("../../src/routes/logs.js");

describe("Log Sorting Logic", () => {
  // Auto-cleanup mocks
  useMockCleanup();

  /** @type {import("../../src/routes/logs.js").Request} */
  let req;
  /** @type {import("../../src/routes/logs.js").Response} */
  let res;
  let next;
  let mockWebhookManager;

  const mockItems = [
    {
      id: "item1",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:00Z",
      statusCode: 200,
      processingTime: 100,
      method: "GET",
      requestId: "REQ-A",
      remoteIp: "10.0.0.1",
    },
    {
      id: "item2",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:02Z",
      statusCode: 500,
      processingTime: 50,
      method: "POST",
      requestId: "REQ-C",
      remoteIp: "192.168.1.1",
    },
    {
      id: "item3",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:01Z",
      statusCode: 404,
      processingTime: 200,
      method: "PUT",
      requestId: "REQ-B",
      remoteIp: "127.0.0.1",
    },
  ];

  beforeEach(() => {
    // Setup Dataset Mock
    createDatasetMock({ items: [...mockItems] });

    // Setup WebhookManager Mock
    mockWebhookManager = createMockWebhookManager();
    mockWebhookManager.isValid.mockReturnValue(true);

    // Setup Request/Response
    res = createMockResponse();
    next = createMockNextFunction();
  });

  const getHandler = () => createLogsHandler(mockWebhookManager);

  it("should sort by timestamp desc by default", async () => {
    req = createMockRequest({ query: {} });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item2", "item3", "item1"]); // Newest first
  });

  it("should sort by timestamp asc", async () => {
    req = createMockRequest({ query: { sort: "timestamp:asc" } });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item1", "item3", "item2"]); // Oldest first
  });

  it("should sort by statusCode desc", async () => {
    req = createMockRequest({ query: { sort: "statusCode:desc" } });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const codes = response.items.map((i) => i.statusCode);
    expect(codes).toEqual([500, 404, 200]);
  });

  it("should sort by processingTime desc", async () => {
    req = createMockRequest({ query: { sort: "processingTime:desc" } });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const times = response.items.map((i) => i.processingTime);
    expect(times).toEqual([200, 100, 50]);
  });

  it("should sort by remoteIp asc", async () => {
    req = createMockRequest({ query: { sort: "remoteIp:asc" } });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const ips = response.items.map((i) => i.remoteIp);
    expect(ips).toEqual(["10.0.0.1", "127.0.0.1", "192.168.1.1"]);
  });

  it("should sort by requestId desc", async () => {
    req = createMockRequest({ query: { sort: "requestId:desc" } });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const rids = response.items.map((i) => i.requestId);
    expect(rids).toEqual(["REQ-C", "REQ-B", "REQ-A"]);
  });

  it("should fallback to timestamp if invalid field provided", async () => {
    req = createMockRequest({ query: { sort: "invalidField:asc" } });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item2", "item3", "item1"]);
  });

  it("should sort by multiple fields", async () => {
    const multiItems = [
      {
        id: "A",
        statusCode: 200,
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "wh_1",
      },
      {
        id: "B",
        statusCode: 200,
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "wh_1",
      },
      {
        id: "C",
        statusCode: 500,
        timestamp: "2023-01-01T10:00:01Z",
        webhookId: "wh_1",
      },
    ];
    createDatasetMock({ items: multiItems });

    req = createMockRequest({
      query: { sort: "statusCode:asc,timestamp:desc" },
    });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["B", "A", "C"]);
  });

  it("should filter by headers (string match)", async () => {
    const headerItems = [
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
    ];
    createDatasetMock({ items: headerItems });

    req = createMockRequest({ query: { headers: "x-foo" } });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item3", "item1"]);
  });

  it("should filter by headers (object match)", async () => {
    const headerItems = [
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
    ];
    createDatasetMock({ items: headerItems });

    req = createMockRequest({
      query: {
        headers: { "content-type": "json" },
      },
    });
    await getHandler()(req, res, next);

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item3", "item1"]);
  });
});
