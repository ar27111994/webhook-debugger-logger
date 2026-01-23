import { jest } from "@jest/globals";
import { createLogsHandler } from "../../src/routes/logs.js";
import { MAX_ITEMS_FOR_BATCH } from "../../src/consts.js";
import { setupTestApp } from "../setup/app-utils.js";
import { Actor } from "apify"; // Mocked

// Mock Apify and Dataset
jest.mock("apify");

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
    },
    {
      id: "item2",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:02Z",
      statusCode: 500,
      processingTime: 50,
      method: "POST",
    },
    {
      id: "item3",
      webhookId: "wh_1",
      timestamp: "2023-01-01T10:00:01Z",
      statusCode: 404,
      processingTime: 200,
      method: "PUT",
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
      getData: jest.fn().mockResolvedValue({ items: mockItems }),
    };
    Actor.openDataset.mockResolvedValue(mockDataset);

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

  it("should sort by statusCode asc", async () => {
    req = {
      query: { sort: "statusCode:asc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    const codes = response.items.map((i) => i.statusCode);
    expect(codes).toEqual([200, 404, 500]);
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
    // Add mock IPs to items for this test
    mockItems[0].remoteIp = "10.0.0.1";
    mockItems[1].remoteIp = "192.168.1.1";
    mockItems[2].remoteIp = "127.0.0.1";

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

  it("should fallback to timestamp if invalid field provided", async () => {
    req = {
      query: { sort: "invalidField:asc" },
      protocol: "http",
      get: () => "localhost",
      baseUrl: "",
    };
    await getHandler()(req, res, jest.fn());

    const response = res.json.mock.calls[0][0];
    // Should fallback to default timestamp logic sort, but user asked for asc in invalid field.
    // Our implementation falls back to Field=timestamp, but keeps Dir if parsed?
    // Let's check logic:
    // let [sortField, sortDir] = sortParam.split(":");
    // if (!allowed.includes(sortField)) sortField = "timestamp";
    // So "invalid:asc" -> sortField="timestamp", sortDir="asc"

    const ids = response.items.map((i) => i.id);
    expect(ids).toEqual(["item1", "item3", "item2"]); // Timestamp ASC
  });
});
