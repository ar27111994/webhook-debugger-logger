/**
 * @file tests/unit/logs_route_list.test.js
 * @description Unit tests for log listing route handler with filtering and pagination.
 */
import { jest, describe, test, expect } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  assertType,
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "../setup/helpers/test-utils.js";

// Setup mocked environment first
await setupCommonMocks({
  logger: true,
  repositories: true,
});

// Import dependencies
import { createLogsHandler } from "../../src/routes/logs.js";
import { logRepositoryMock } from "../setup/helpers/shared-mocks.js";
import { HTTP_STATUS } from "../../src/consts/http.js";
import { SORT_DIRECTIONS } from "../../src/consts/app.js";

describe("Logs Route Listing", () => {
  const mockWebhookManager = assertType({});

  describe("Filtering & Sorting", () => {
    test("should parse and apply standard filters", async () => {
      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: logRepositoryMock,
      });
      const req = createMockRequest({
        query: {
          webhookId: "wh_123",
          method: "POST",
          statusCode: HTTP_STATUS.OK.toString(),
          limit: "50",
          offset: "10",
        },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      logRepositoryMock.findLogs.mockResolvedValue({
        items: [],
        total: 0,
      });

      await handler(req, res, next);

      expect(logRepositoryMock.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: "wh_123",
          method: "POST",
          statusCode: [{ operator: "eq", value: HTTP_STATUS.OK }],
        }),
      );
    });

    test("should handle date range filters", async () => {
      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: logRepositoryMock,
      });
      const req = createMockRequest({
        query: {
          startTime: "2023-01-01T00:00:00Z",
          endTime: "2023-01-02T00:00:00Z",
        },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      logRepositoryMock.findLogs.mockResolvedValue({ items: [], total: 0 });

      await handler(req, res, next);

      expect(logRepositoryMock.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.arrayContaining([
            { operator: "gte", value: "2023-01-01T00:00:00.000Z" },
            { operator: "lte", value: "2023-01-02T00:00:00.000Z" },
          ]),
        }),
      );
    });

    test("should handle sorting parameters", async () => {
      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: logRepositoryMock,
      });
      const req = createMockRequest({
        query: {
          sort: `size:${SORT_DIRECTIONS.ASC},timestamp:${SORT_DIRECTIONS.DESC}`,
        },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      logRepositoryMock.findLogs.mockResolvedValue({ items: [], total: 0 });

      await handler(req, res, next);

      expect(logRepositoryMock.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: [
            { field: "size", dir: SORT_DIRECTIONS.ASC },
            { field: "timestamp", dir: SORT_DIRECTIONS.DESC },
          ],
        }),
      );
    });

    test("should use default sort if empty string provided", async () => {
      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: logRepositoryMock,
      });
      const req = createMockRequest({ query: { sort: "" } }); // Explicit empty string
      const res = createMockResponse();
      const next = createMockNextFunction();

      logRepositoryMock.findLogs.mockResolvedValue({ items: [], total: 0 });

      await handler(req, res, next);

      expect(logRepositoryMock.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: [{ field: "timestamp", dir: SORT_DIRECTIONS.DESC }],
        }),
      );
    });
  });

  describe("Pagination", () => {
    test("should handle cursor-based pagination", async () => {
      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: logRepositoryMock,
      });
      const req = createMockRequest({
        query: {
          cursor: "next_page_cursor",
          limit: "10",
        },
        baseUrl: "/logs",
        protocol: "http",
        get: assertType(jest.fn(() => "localhost")),
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      const mockItems = [
        assertType({ id: "log_1", webhookId: "wh_1" }),
        assertType({ id: "log_2", webhookId: "wh_1" }),
      ];

      logRepositoryMock.findLogsCursor.mockResolvedValue({
        items: mockItems,
        nextCursor: "cursor_for_page_3",
      });

      await handler(req, res, next);

      expect(logRepositoryMock.findLogsCursor).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: "next_page_cursor",
          limit: 10,
        }),
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              detailUrl: "http://localhost/logs/log_1",
            }),
          ]),
          nextCursor: "cursor_for_page_3",
          nextPageUrl: expect.stringContaining("cursor=cursor_for_page_3"),
        }),
      );
    });

    test("should handle offset-based pagination metadata", async () => {
      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: logRepositoryMock,
      });
      const req = createMockRequest({
        query: { limit: "10", offset: "0" },
        baseUrl: "/logs",
        protocol: "http",
        get: assertType(jest.fn(() => "localhost")),
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      logRepositoryMock.findLogs.mockResolvedValue({
        items: Array(10).fill(assertType({ id: "log_x", webhookId: "wh_1" })),
        total: 50,
      });

      await handler(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          nextOffset: 10,
          nextPageUrl: expect.stringContaining("offset=10"),
        }),
      );
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on repository error", async () => {
      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: logRepositoryMock,
      });
      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNextFunction();

      logRepositoryMock.findLogs.mockRejectedValue(new Error("DB Error"));

      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Logs Failed" }),
      );
    });
  });
});
