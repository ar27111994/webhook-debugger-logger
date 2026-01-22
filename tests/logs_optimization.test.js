import { jest, describe, test, expect } from "@jest/globals";
import { useMockCleanup } from "./helpers/test-lifecycle.js";
import {
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
  assertType,
} from "./helpers/test-utils.js";
import { MAX_ITEMS_FOR_BATCH } from "../src/consts.js";

/**
 * @typedef {import("apify").DatasetDataOptions} DatasetDataOptions
 * @typedef {import("apify").DatasetContent<WebhookEvent>} DatasetContent
 * @typedef {import('../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../src/typedefs.js').WebhookEvent} WebhookEvent
 */

// Mock Apify
import { setupCommonMocks } from "./helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

import { apifyMock, createMockWebhookManager } from "./helpers/shared-mocks.js";

// Mock Dataset
const { createDatasetMock } = await import("./helpers/shared-mocks.js");
const mockItems = [
  {
    id: "log_1",
    webhookId: "wh_1",
    timestamp: "2023-01-01T10:00:00Z",
    method: "POST",
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: '{"foo":"bar"}', // Should be projected out in list view
    remoteIp: "1.2.3.4",
    userAgent: "GoogleBot",
    signatureValid: true,
  },
  {
    id: "log_2",
    webhookId: "wh_1",
    timestamp: "2023-01-01T11:00:00Z",
    method: "POST",
    statusCode: 400,
    headers: { "content-type": "application/json" },
    body: '{"error":"bad_request"}',
    remoteIp: "5.6.7.8",
    userAgent: "Mozilla/5.0",
    signatureValid: false,
  },
];

const mockDataset = createDatasetMock(mockItems);
// No manual implementation needed anymore - createDatasetMock handles it all

jest.mocked(apifyMock.openDataset).mockResolvedValue(assertType(mockDataset));

const { createLogsHandler, createLogDetailHandler } =
  await import("../src/routes/logs.js");

describe("Log Optimization Tests", () => {
  /** @type {WebhookManager} */
  let webhookManagerMock;

  useMockCleanup(() => {
    webhookManagerMock = createMockWebhookManager({
      isValid: true,
    });
    jest
      .mocked(apifyMock.openDataset)
      .mockResolvedValue(assertType(mockDataset));
  });

  describe("GET /logs (List View)", () => {
    test("should request specific fields (projection) to save bandwidth", async () => {
      const handler = createLogsHandler(webhookManagerMock);
      const req = createMockRequest({
        query: { limit: String(MAX_ITEMS_FOR_BATCH) },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      expect(mockDataset.getData).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: MAX_ITEMS_FOR_BATCH, // Implementation uses chunk size
          desc: true,
          // Verify 'fields' parameter is present and excludes 'body'
          fields: expect.arrayContaining([
            "id",
            "webhookId",
            "timestamp",
            "method",
            "statusCode",
            "headers",
            "signatureValid",
            "requestId",
            "remoteIp",
            "userAgent",
            "contentType",
          ]),
        }),
      );
    });

    test("should NOT return 'body' in list view", async () => {
      const handler = createLogsHandler(webhookManagerMock);
      const req = createMockRequest({ baseUrl: "/logs" });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      const responseData = jest.mocked(res.json).mock.calls[0][0];
      // Logs are sorted descending by timestamp, so log_2 (11:00) comes before log_1 (10:00)
      expect(responseData.items[0]).not.toHaveProperty("body");
      expect(responseData.items[0]).toHaveProperty("id", "log_2");
      expect(responseData.items[0]).toHaveProperty("detailUrl");
      expect(responseData.items[0].detailUrl).toBe(
        "http://localhost/logs/log_2",
      );
    });

    test("should filter by remoteIp", async () => {
      const handler = createLogsHandler(webhookManagerMock);
      const req = createMockRequest({ query: { remoteIp: "1.2.3.4" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      const responseData = jest.mocked(res.json).mock.calls[0][0];
      expect(responseData.items).toHaveLength(1);
      expect(responseData.items[0].remoteIp).toBe("1.2.3.4");
    });

    test("should filter by userAgent", async () => {
      const handler = createLogsHandler(webhookManagerMock);
      const req = createMockRequest({ query: { userAgent: "Mozilla/5.0" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      const responseData = jest.mocked(res.json).mock.calls[0][0];
      expect(responseData.items).toHaveLength(1);
      expect(responseData.items[0].userAgent).toBe("Mozilla/5.0");
    });

    test("should return correct nextOffset for pagination", async () => {
      const handler = createLogsHandler(webhookManagerMock);
      // We start at offset 0 with limit 1.
      // The implementation should process the chunk and return a nextOffset
      // allowing the client to continue scanning from the next chunk or valid position.
      const req = createMockRequest({
        query: { limit: "1" },
        baseUrl: "/logs",
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      const responseData = jest.mocked(res.json).mock.calls[0][0];
      expect(responseData).toHaveProperty("nextOffset");
      expect(responseData.nextOffset).toBeDefined();
      expect(responseData).toHaveProperty("nextPageUrl");
      expect(responseData.nextPageUrl).toContain("limit=1");
    });
  });

  describe("GET /logs/:logId (Detail View)", () => {
    test("should return full object (including body) for valid ID", async () => {
      // Must implement this handler in the next step
      if (!createLogDetailHandler) return;

      const handler = createLogDetailHandler(webhookManagerMock);
      const req = createMockRequest({ params: { logId: "log_1" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      const data = jest.mocked(res.json).mock.calls[0][0];
      expect(data).toHaveProperty("body");
      expect(data.id).toBe("log_1");
    });

    test("should return 404 for non-existent ID", async () => {
      if (!createLogDetailHandler) return;

      const handler = createLogDetailHandler(webhookManagerMock);
      const req = createMockRequest({ params: { logId: "non_existent" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(jest.mocked(res.json).mock.calls[0][0]).toHaveProperty("error");
    });
  });
});
