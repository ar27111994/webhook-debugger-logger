import { jest } from "@jest/globals";

// Define mock factory BEFORE imports
const mockOpenDataset = jest.fn();
jest.unstable_mockModule("apify", () => ({
  Actor: {
    openDataset: mockOpenDataset,
  },
}));

// Dynamic imports to ensure mock is used
const { createLogsHandler } = await import("../../src/routes/logs.js");

describe("Log Sorting Logic", () => {
  let req, res, mockDataset, mockWebhookManager;

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
    jest.clearAllMocks();

    // Mock Response
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    // Mock Dataset
    mockDataset = {
      getInfo: jest.fn().mockResolvedValue({ itemCount: 3 }),
      getData: jest.fn().mockResolvedValue({ items: [...mockItems] }), // Clone array
    };
    mockOpenDataset.mockResolvedValue(mockDataset);

    // Mock WebhookManager
    mockWebhookManager = {
      isValid: jest.fn().mockReturnValue(true),
    };
  });

  const getHandler = () => createLogsHandler(mockWebhookManager);

  it("should sort by timestamp desc by default", async () => {
    req = { query: {}, protocol: "http", get: () => "localhost", baseUrl: "" };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item2", "item3", "item1"]); // Newest first
  });

  it("should sort by timestamp asc", async () => {
    req = {
      query: { sort: "timestamp:asc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item1", "item3", "item2"]); // Oldest first
  });

  it("should sort by statusCode desc", async () => {
    req = {
      query: { sort: "statusCode:desc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const codes = response.items.map((i) => i.statusCode);
    expect(codes).toEqual([500, 404, 200]);
  });

  it("should sort by processingTime desc", async () => {
    req = {
      query: { sort: "processingTime:desc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const times = response.items.map((i) => i.processingTime);
    expect(times).toEqual([200, 100, 50]);
  });

  it("should sort by remoteIp asc", async () => {
    req = {
      query: { sort: "remoteIp:asc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const ips = response.items.map((i) => i.remoteIp);
    expect(ips).toEqual(["10.0.0.1", "127.0.0.1", "192.168.1.1"]);
  });

  it("should sort by requestId desc", async () => {
    req = {
      query: { sort: "requestId:desc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const rids = response.items.map((i) => i.requestId);
    expect(rids).toEqual(["REQ-C", "REQ-B", "REQ-A"]);
  });

  it("should fallback to timestamp if invalid field provided", async () => {
    req = {
      query: { sort: "invalidField:asc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    // Invalid criteria removed, default added (timestamp:desc)
    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item2", "item3", "item1"]);
  });

  it("should sort by multiple fields", async () => {
    // Setup items with identical status codes to test secondary sort
    const multiItems = [
      { id: "A", statusCode: 200, timestamp: "2023-01-01T10:00:00Z" },
      { id: "B", statusCode: 200, timestamp: "2023-01-01T10:00:02Z" }, // Newer
      { id: "C", statusCode: 500, timestamp: "2023-01-01T10:00:01Z" },
    ];
    mockDataset.getData.mockResolvedValue({ items: multiItems });

    req = {
      query: { sort: "statusCode:asc,timestamp:desc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const ids = response.items.map((i) => i.id);

    // Expect:
    // 1. C (500) - last because asc
    // 2. A and B are 200.
    //    Sort by timestamp desc -> B (Newer) then A (Older)
    // Order: A, B, C if simple sort... wait.
    // statusCode asc: [200, 200, 500] -> [A, B] then C
    // Secondary: timestamp desc. B is newer than A. So B comes before A.
    // Result: B, A, C
    expect(ids).toEqual(["B", "A", "C"]);
  });
});
