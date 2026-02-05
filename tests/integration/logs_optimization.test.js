import { jest, describe, test, expect } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";
import {
  HTTP_STATUS,
  MAX_ITEMS_FOR_BATCH,
  REQUEST_ID_PREFIX,
} from "../../src/consts.js";

/**
 * @typedef {import("apify").DatasetDataOptions} DatasetDataOptions
 * @typedef {import("apify").DatasetContent<WebhookEvent>} DatasetContent
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 */

// Mock Apify
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

import { createMockWebhookManager } from "../setup/helpers/shared-mocks.js";

import { logRepository } from "../../src/repositories/LogRepository.js";
import { useDbHooks } from "../setup/helpers/test-lifecycle.js";

const { createLogsHandler, createLogDetailHandler } =
  await import("../../src/routes/logs.js");

describe("Log Optimization Tests", () => {
  /** @type {WebhookManager} */
  let webhookManagerMock;

  useMockCleanup(() => {
    webhookManagerMock = createMockWebhookManager({
      isValid: true,
    });
  });
  useDbHooks();

  beforeEach(async () => {
    await logRepository.batchInsertLogs([
      {
        id: "log_1",
        webhookId: "wh_1",
        timestamp: "2023-01-01T10:00:00Z",
        method: "POST",
        statusCode: HTTP_STATUS.OK,
        headers: { "content-type": "application/json" },
        body: '{"foo":"bar"}',
        remoteIp: "1.2.3.4",
        userAgent: "GoogleBot",
        signatureValid: false, // Default logic in repository might be null, usually handled by validation mw
        processingTime: 10,
        query: {},
        size: 100,
        contentType: "application/json",
        requestId: `${REQUEST_ID_PREFIX}1`,
      },
      {
        id: "log_2",
        webhookId: "wh_1",
        timestamp: "2023-01-01T11:00:00Z", // LOG_2 IS NEWER (11:00 vs 10:00)
        method: "POST",
        statusCode: HTTP_STATUS.BAD_REQUEST,
        headers: { "content-type": "application/json" },
        body: '{"error":"bad_request"}',
        remoteIp: "5.6.7.8",
        userAgent: "Mozilla/5.0",
        signatureValid: false,
        processingTime: 10,
        query: {},
        size: 100,
        contentType: "application/json",
        requestId: `${REQUEST_ID_PREFIX}2`,
      },
    ]);
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

      jest.spyOn(logRepository, "findLogs");
      await handler(req, res, next);

      const responseData = jest.mocked(res.json).mock.calls[0][0];
      expect(responseData.items[0]).toHaveProperty("id");
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

    test("should return HTTP_STATUS.NOT_FOUND for non-existent ID", async () => {
      if (!createLogDetailHandler) return;

      const handler = createLogDetailHandler(webhookManagerMock);
      const req = createMockRequest({ params: { logId: "non_existent" } });
      const res = createMockResponse();
      const next = createMockNextFunction();

      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(jest.mocked(res.json).mock.calls[0][0]).toHaveProperty("error");
    });
  });
});
