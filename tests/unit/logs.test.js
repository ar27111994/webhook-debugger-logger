/**
 * @file tests/unit/logs.test.js
 * @description Unit tests for the logs routes and filtering logic.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  assertType,
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";
import {
  HTTP_HEADERS,
  HTTP_METHODS,
  HTTP_STATUS,
  MIME_TYPES,
} from "../../src/consts/http.js";
import { ERROR_LABELS, ERROR_MESSAGES } from "../../src/consts/errors.js";
import { STORAGE_CONSTS } from "../../src/consts/storage.js";
import { PAGINATION_CONSTS } from "../../src/consts/database.js";
import { SORT_DIRECTIONS } from "../../src/consts/app.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

await setupCommonMocks({
  apify: true,
  repositories: true,
  webhookManager: true,
});

const {
  apifyMock: mockApifyActor,
  logRepositoryMock: mockLogRepo,
  webhookManagerMock: mockWebhookManager,
  createKeyValueStoreMock,
} = await import("../setup/helpers/shared-mocks.js");

await jest.resetModules();

const { createLogsHandler, createLogDetailHandler, createLogPayloadHandler } =
  await import("../../src/routes/logs.js");

const MOCK_WH_ID = "wh-1";

describe("Logs Routes", () => {
  /** @type {Request} */
  let mockReq;
  /** @type {Response} */
  let mockRes;
  /** @type {NextFunction} */
  let mockNext;

  beforeEach(() => {
    mockReq = createMockRequest({
      protocol: "https",
      get: assertType(jest.fn()).mockReturnValue("example.com"),
      baseUrl: "/admin/api/logs",
      params: {},
      query: {},
    });
    mockRes = createMockResponse();
    mockNext = createMockNextFunction();
    jest.clearAllMocks();
  });

  describe("createLogsHandler", () => {
    it("should return paginated offset logs correctly and handle defaults", async () => {
      const mockStoredLogs = {
        items: [
          { id: "1", webhookId: "wh1" },
          { id: "2", webhookId: "wh1" },
        ],
        total: 5,
      };
      mockLogRepo.findLogs.mockResolvedValueOnce(assertType(mockStoredLogs));

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: PAGINATION_CONSTS.MAX_PAGE_LIMIT,
          offset: 0,
          sort: [{ field: "timestamp", dir: SORT_DIRECTIONS.DESC }],
        }),
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          count: mockStoredLogs.items.length,
          total: mockStoredLogs.total,
          items: expect.arrayContaining([
            expect.objectContaining({
              id: "1",
              detailUrl: "https://example.com/admin/api/logs/1",
            }),
            expect.objectContaining({
              id: "2",
              detailUrl: "https://example.com/admin/api/logs/2",
            }),
          ]),
          nextOffset: PAGINATION_CONSTS.MAX_PAGE_LIMIT,
          nextPageUrl: expect.stringContaining("offset=10000"),
        }),
      );
    });

    it("should return paginated cursor logs efficiently", async () => {
      mockReq.query = { cursor: "abc123cursor" };
      const mockStoredLogs = {
        items: [{ id: "cursor1", webhookId: "wh1" }],
        nextCursor: "nextcursor456",
      };
      mockLogRepo.findLogsCursor.mockResolvedValueOnce(
        assertType(mockStoredLogs),
      );

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogsCursor).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: mockReq.query.cursor,
          offset: undefined, // cursor pagination shouldn't pass offset mapping
        }),
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          count: mockStoredLogs.items.length,
          items: expect.arrayContaining([
            expect.objectContaining({
              detailUrl: "https://example.com/admin/api/logs/cursor1",
            }),
          ]),
          nextCursor: mockStoredLogs.nextCursor,
          nextPageUrl: expect.stringContaining(
            `cursor=${mockStoredLogs.nextCursor}`,
          ),
        }),
      );
    });

    it("should translate complex parsing parameters (ranges, sort fields) cleanly", async () => {
      mockReq.query = {
        startTime: "2023-01-01",
        endTime: "2023-12-31",
        sort: "method:asc,statusCode:desc",
        statusCode: assertType({ gte: HTTP_STATUS.BAD_REQUEST }),
        signatureValid: "true",
      };
      mockLogRepo.findLogs.mockResolvedValueOnce({ items: [], total: 0 });

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          signatureValid: true,
          statusCode: [{ operator: "gte", value: HTTP_STATUS.BAD_REQUEST }],
          sort: [
            { field: "method", dir: SORT_DIRECTIONS.ASC },
            { field: "statusCode", dir: SORT_DIRECTIONS.DESC },
          ],
          timestamp: expect.arrayContaining([
            {
              operator: "gte",
              value: new Date(String(mockReq.query.startTime)).toISOString(),
            },
            {
              operator: "lte",
              value: new Date(String(mockReq.query.endTime)).toISOString(),
            },
          ]),
        }),
      );
    });

    it("should catch database errors and return 500 cleanly", async () => {
      mockLogRepo.findLogs.mockRejectedValueOnce(new Error("DB Failure"));

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        error: ERROR_LABELS.LOGS_FAILED,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
      });
    });

    it("should fallback to default sort arrays when sort parameter is sent as empty string", async () => {
      mockReq.query = { sort: "" };
      mockLogRepo.findLogs.mockResolvedValueOnce({ items: [], total: 0 });

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: [{ field: "timestamp", dir: SORT_DIRECTIONS.DESC }],
        }),
      );
    });

    it("should fallback to first valid sort field if timestamp is not in valid fields", async () => {
      mockReq.query = { sort: "" };
      mockLogRepo.findLogs.mockResolvedValueOnce({ items: [], total: 0 });

      // Mock includes to return false specifically for TIMESTAMP in the VALID_SORT_FIELDS array safely
      const originalIncludes = Array.prototype.includes;
      const EXPECTED_FIELDS_LEN = 15;
      /**
       * @param {string} searchElement
       * @param {number} fromIndex
       */
      Array.prototype.includes = function (searchElement, fromIndex) {
        // Duck type the VALID_SORT_FIELDS array
        if (
          this &&
          this.length === EXPECTED_FIELDS_LEN &&
          this[0] === "id" &&
          searchElement === "timestamp"
        ) {
          return false;
        }
        return originalIncludes.call(this, searchElement, fromIndex);
      };

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: [{ field: "id", dir: SORT_DIRECTIONS.DESC }], // 'id' corresponds to VALID_SORT_FIELDS[0]
        }),
      );

      Array.prototype.includes = originalIncludes;
    });

    it("should correctly parse valid timestamp range queries dynamically", async () => {
      mockReq.query = {
        timestamp: ">=2023-01-01",
      };
      mockLogRepo.findLogs.mockResolvedValueOnce({ items: [], total: 0 });

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.arrayContaining([
            expect.objectContaining({
              operator: "eq",
              value: mockReq.query.timestamp,
            }),
          ]),
        }),
      );
    });

    it("should map all query level filters dynamically parsing defaults securely", async () => {
      mockReq.query = {
        id: "log-1",
        webhookId: "wh-test",
        requestUrl: "https://test.local",
        method: HTTP_METHODS.POST,
        contentType: MIME_TYPES.XML,
        requestId: "x-req",
        remoteIp: "127.0.0.1",
        userAgent: "mockAgent",
        signatureProvider: "mockProvider",
        signatureError: "none",
        limit: "2",
        offset: "10",
        sort: "invalid:",
      };
      jest
        .mocked(mockLogRepo.findLogs)
        .mockResolvedValueOnce({ items: [], total: 0 });

      // Testing no `deps` parameter array to default mapped repo
      const handler = createLogsHandler(mockWebhookManager);
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "log-1",
          webhookId: "wh-test",
          requestUrl: "https://test.local",
          method: HTTP_METHODS.POST,
          contentType: MIME_TYPES.XML,
          requestId: "x-req",
          remoteIp: "127.0.0.1",
          userAgent: "mockAgent",
          signatureProvider: "mockProvider",
          signatureError: "none",
          limit: 2,
          offset: 10,
        }),
      );
    });

    it("should handle falsy parsing branches and invalid values gracefully", async () => {
      // Tests branches:
      // - parseInt failing (falling back to constants)
      // - timestamp parseRangeQuery returning null
      // - sort field empty string splits (split by ':')
      mockReq.query = {
        limit: "notanumber",
        offset: "notanumber",
        timestamp: "invalid", // Usually null
        sort: ":asc,method:desc", // Covers `!field` continue branch
      };
      mockLogRepo.findLogs.mockResolvedValueOnce({ items: [], total: 0 });

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: PAGINATION_CONSTS.DEFAULT_PAGE_LIMIT,
          offset: PAGINATION_CONSTS.DEFAULT_PAGE_OFFSET,
          sort: [{ field: "method", dir: SORT_DIRECTIONS.DESC }], // Only parsed `method`
        }),
      );
    });

    it("should handle terminal cursor pagination gracefully when no next cursor exists", async () => {
      mockReq.query = { cursor: "abc123cursor" };
      const mockStoredLogs = {
        items: [{ id: "cursor1", webhookId: "wh1" }],
        nextCursor: null, // Covers !nextCursor branch
      };
      mockLogRepo.findLogsCursor.mockResolvedValueOnce(
        assertType(mockStoredLogs),
      );

      const handler = createLogsHandler(mockWebhookManager, {
        logRepo: mockLogRepo,
      });
      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          nextCursor: null,
          nextPageUrl: null,
        }),
      );
    });
  });

  describe("createLogDetailHandler", () => {
    it("should retrieve a log by id missing fields fetching everything internally", async () => {
      mockReq.params = { logId: "log-1" };
      const mockLogData = { id: "log-1", webhookId: MOCK_WH_ID };
      jest
        .mocked(mockLogRepo.getLogById)
        .mockResolvedValueOnce(assertType(mockLogData));

      const handler = createLogDetailHandler(mockWebhookManager);

      await handler(mockReq, mockRes, mockNext);

      expect(mockLogRepo.getLogById).toHaveBeenCalledWith("log-1", []);
      expect(mockRes.json).toHaveBeenCalledWith(mockLogData);
    });

    it("should slice requested fields properly, but implicitly include webhookId, stripping it later if unrequested", async () => {
      mockReq.params = { logId: "log-1" };
      mockReq.query = { fields: "id,method" };
      jest
        .mocked(mockLogRepo.getLogById)
        .mockResolvedValueOnce(
          assertType({
            id: "log-1",
            method: HTTP_METHODS.POST,
            webhookId: MOCK_WH_ID,
          }),
        );

      const handler = createLogDetailHandler(mockWebhookManager);
      await handler(mockReq, mockRes, mockNext);

      // Verify webhookId was requested silently for validation
      expect(mockLogRepo.getLogById).toHaveBeenCalledWith("log-1", [
        "id",
        "method",
        "webhookId",
      ]);

      // Verify it was stripped when delivered
      expect(mockRes.json).toHaveBeenCalledWith({
        id: "log-1",
        method: HTTP_METHODS.POST,
      });
    });
    it("should return 404 if log is not found", async () => {
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(null);

      const handler = createLogDetailHandler(mockWebhookManager);
      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: ERROR_MESSAGES.LOG_NOT_FOUND,
      });
    });

    it("should return 404 if the corresponding webhook configuration is no longer active", async () => {
      jest
        .mocked(mockLogRepo.getLogById)
        .mockResolvedValueOnce(
          assertType({ id: "log-1", webhookId: "deleted-wh" }),
        );
      jest.mocked(mockWebhookManager.isValid).mockReturnValueOnce(false);

      const handler = createLogDetailHandler(mockWebhookManager);
      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
    });

    it("should return 500 if database fetching throws", async () => {
      jest
        .mocked(mockLogRepo.getLogById)
        .mockRejectedValueOnce(new Error("Boom"));
      const handler = createLogDetailHandler(mockWebhookManager);
      await handler(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    });
  });

  describe("createLogPayloadHandler", () => {
    /** @type {RequestHandler} */
    let handler;
    const MOCK_LOG_ID = "log-1";
    const MOCK_KEY = "kvs-key-123";

    beforeEach(() => {
      handler = createLogPayloadHandler(mockWebhookManager);
    });

    it("should return 404 if the log is not found", async () => {
      mockReq.params = { logId: "missing-log" };
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(null);

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
    });

    it("should return 404 if the log webhook is invalid", async () => {
      mockReq.params = { logId: MOCK_LOG_ID };
      jest
        .mocked(mockLogRepo.getLogById)
        .mockResolvedValueOnce(
          assertType({ id: MOCK_LOG_ID, webhookId: "deleted-wh" }),
        );
      jest.mocked(mockWebhookManager.isValid).mockReturnValueOnce(false);

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
    });

    it("should return the body directly if not offloaded", async () => {
      mockReq.params = { logId: MOCK_LOG_ID };
      const directBody = { message: "hello world" };
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(
        assertType({
          id: MOCK_LOG_ID,
          webhookId: MOCK_WH_ID,
          contentType: MIME_TYPES.JSON,
          body: directBody,
        }),
      );

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.CONTENT_TYPE,
        MIME_TYPES.JSON,
      );
      expect(mockRes.json).toHaveBeenCalledWith(directBody);
    });

    it("should fetch the payload from Apify KVS if offloaded", async () => {
      mockReq.params = { logId: MOCK_LOG_ID };
      const offloadedPayloadInfo = {
        data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
        key: MOCK_KEY,
      };
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(
        assertType({
          id: MOCK_LOG_ID,
          webhookId: MOCK_WH_ID,
          contentType: MIME_TYPES.TEXT,
          body: offloadedPayloadInfo,
        }),
      );

      const TEST_PAYLOAD = "very large text payload";
      const mockStore = createKeyValueStoreMock({
        getValue: jest.fn(() => Promise.resolve(TEST_PAYLOAD)),
      });
      jest
        .mocked(mockApifyActor.openKeyValueStore)
        .mockResolvedValueOnce(mockStore);

      await handler(mockReq, mockRes, mockNext);

      expect(mockApifyActor.openKeyValueStore).toHaveBeenCalled();
      expect(mockStore.getValue).toHaveBeenCalledWith(MOCK_KEY);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.CONTENT_TYPE,
        MIME_TYPES.TEXT,
      );
      expect(mockRes.send).toHaveBeenCalledWith(TEST_PAYLOAD);
    });

    it("should send json if value returned from KVS is an object", async () => {
      mockReq.params = { logId: MOCK_LOG_ID };
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(
        assertType({
          id: MOCK_LOG_ID,
          webhookId: MOCK_WH_ID,
          body: { data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC, key: MOCK_KEY },
        }),
      );
      const mockStore = createKeyValueStoreMock({
        getValue: jest.fn(() => Promise.resolve({ kvs: "data" })),
      });
      jest
        .mocked(mockApifyActor.openKeyValueStore)
        .mockResolvedValueOnce(mockStore);

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({ kvs: "data" });
    });

    it("should send 404 if KVS payload fetch fails resolving (null value)", async () => {
      mockReq.params = { logId: MOCK_LOG_ID };
      const offloadedPayloadInfo = {
        data: STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
        key: MOCK_KEY,
      };
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(
        assertType({
          id: MOCK_LOG_ID,
          webhookId: MOCK_WH_ID,
          body: offloadedPayloadInfo,
        }),
      );
      const mockStore = createKeyValueStoreMock({
        getValue: jest.fn(() => Promise.resolve(null)),
      });
      jest
        .mocked(mockApifyActor.openKeyValueStore)
        .mockResolvedValueOnce(mockStore);

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
    });

    it("should format returning object formats securely via buffer checks", async () => {
      mockReq.params = { logId: MOCK_LOG_ID };
      const offloadedPayloadInfo = {
        data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
        key: MOCK_KEY,
      };
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(
        assertType({
          id: MOCK_LOG_ID,
          webhookId: MOCK_WH_ID,
          body: offloadedPayloadInfo,
        }),
      );

      const testBuffer = Buffer.from("buffer test");
      const mockStore = createKeyValueStoreMock({
        getValue: jest.fn(() => Promise.resolve(testBuffer)),
      });
      jest
        .mocked(mockApifyActor.openKeyValueStore)
        .mockResolvedValueOnce(mockStore);

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.send).toHaveBeenCalledWith(testBuffer);
    });

    it("should format returning object formats securely via JSON checks", async () => {
      mockReq.params = { logId: MOCK_LOG_ID };
      const directBody = "straight plaintext";
      jest.mocked(mockLogRepo.getLogById).mockResolvedValueOnce(
        assertType({
          id: MOCK_LOG_ID,
          webhookId: MOCK_WH_ID,
          body: directBody,
        }),
      );

      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.send).toHaveBeenCalledWith(directBody);
    });

    it("should return 500 cleanly on handler operation exceptions", async () => {
      jest
        .mocked(mockLogRepo.getLogById)
        .mockRejectedValueOnce(new Error("KVS Access Denied"));

      await handler(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        error: ERROR_MESSAGES.PAYLOAD_FETCH_FAILED,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
      });
    });
  });
});
