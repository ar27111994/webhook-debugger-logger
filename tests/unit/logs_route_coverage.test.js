import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { HTTP_STATUS } from "../../src/consts/http.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { createKeyValueStoreMock } from "../setup/helpers/shared-mocks.js";

// Setup dependencies
await setupCommonMocks({
  apify: true,
  logger: true,
  repositories: true,
  consts: true,
});

const { createLogsHandler, createLogDetailHandler, createLogPayloadHandler } =
  await import("../../src/routes/logs.js");

const { OFFLOAD_MARKER_SYNC } =
  await import("../../src/utils/storage_helper.js");

const { logRepositoryMock, apifyMock, webhookManagerMock } =
  await import("../setup/helpers/shared-mocks.js");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 */

describe("Logs Route Coverage", () => {
  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;

  beforeEach(() => {
    res = createMockResponse();
    next = createMockNextFunction();
    logRepositoryMock.findLogs.mockReset();
    logRepositoryMock.findLogsCursor.mockReset();
    logRepositoryMock.getLogById.mockReset();
  });

  describe("createLogsHandler", () => {
    test("should handle legacy startTime/endTime filters", async () => {
      req = createMockRequest({
        query: {
          startTime: "2023-01-01T00:00:00Z",
          endTime: "2023-01-02T00:00:00Z",
        },
      });
      logRepositoryMock.findLogs.mockResolvedValue({ items: [], total: 0 });

      const handler = createLogsHandler(webhookManagerMock, {
        logRepo: logRepositoryMock,
      });
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

    test("should parse multi-field sorting", async () => {
      req = createMockRequest({
        query: {
          sort: "method:asc,timestamp:desc",
        },
      });
      logRepositoryMock.findLogs.mockResolvedValue({ items: [], total: 0 });

      const handler = createLogsHandler(webhookManagerMock, {
        logRepo: logRepositoryMock,
      });
      await handler(req, res, next);

      expect(logRepositoryMock.findLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: [
            { field: "method", dir: "asc" },
            { field: "timestamp", dir: "desc" },
          ],
        }),
      );
    });

    test("should generate correct nextPageUrl for cursor pagination", async () => {
      req = createMockRequest({
        protocol: "http",
        headers: { host: "localhost" },
        baseUrl: "/logs",
        query: { cursor: "curr_cursor", limit: "10" },
      });

      logRepositoryMock.findLogsCursor.mockResolvedValue({
        items: assertType([{ id: "1" }]),
        nextCursor: "next_cursor_123",
      });

      const handler = createLogsHandler(webhookManagerMock, {
        logRepo: logRepositoryMock,
      });
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          nextCursor: "next_cursor_123",
          nextPageUrl: expect.stringContaining("cursor=next_cursor_123"),
        }),
      );
      // Ensure offset is stripped from next link
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          nextPageUrl: expect.not.stringContaining("offset="),
        }),
      );
    });
  });

  describe("createLogDetailHandler", () => {
    test("should strip disallowed fields when specific fields requested but webhookId needed for check", async () => {
      // Setup: Valid webhook
      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      // Setup: Log returned has webhookId for validation, but we only asked for 'method'
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "1",
        webhookId: "wh_1",
        method: "GET",
        body: "foo",
      });
      logRepositoryMock.getLogById.mockResolvedValue(mockLog);

      req = createMockRequest({
        params: { logId: "1" },
        query: { fields: "method" },
      });

      const handler = createLogDetailHandler(webhookManagerMock);
      await handler(req, res, next);

      // Verify repo asked for method + webhookId
      expect(logRepositoryMock.getLogById).toHaveBeenCalledWith(
        "1",
        expect.arrayContaining(["method", "webhookId"]),
      );

      // Verify response HAS method but DOES NOT have webhookId
      expect(res.json).toHaveBeenCalledWith({
        id: "1",
        method: "GET",
        body: "foo",
      });
      const responseArg = jest.mocked(res.json).mock.calls[0][0];
      expect(responseArg).not.toHaveProperty("webhookId");
    });
  });

  describe("createLogPayloadHandler", () => {
    test("should return HTTP_STATUS.NOT_FOUND if KVS offloaded value is missing", async () => {
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "1",
        webhookId: "wh_1",
        body: {
          data: OFFLOAD_MARKER_SYNC,
          key: "missing_key",
        },
      });

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);
      logRepositoryMock.getLogById.mockResolvedValue(mockLog);

      // Mock KVS open
      const mockStore = createKeyValueStoreMock({
        getValue: assertType(jest.fn()).mockResolvedValue(null),
      });
      apifyMock.openKeyValueStore.mockResolvedValue(mockStore);

      req = createMockRequest({ params: { logId: "1" } });
      const handler = createLogPayloadHandler(webhookManagerMock);
      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Payload not found in KVS" }),
      );
    });

    test("should send Buffer directly if value is binary", async () => {
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "1",
        webhookId: "wh_1",
        contentType: "image/png",
        body: {
          data: OFFLOAD_MARKER_SYNC,
          key: "img_key",
        },
      });

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);
      logRepositoryMock.getLogById.mockResolvedValue(mockLog);

      const mockBuffer = Buffer.from("image_data");
      const mockStore = createKeyValueStoreMock({
        getValue: assertType(jest.fn()).mockResolvedValue(mockBuffer),
      });
      apifyMock.openKeyValueStore.mockResolvedValue(mockStore);

      req = createMockRequest({ params: { logId: "1" } });
      const handler = createLogPayloadHandler(webhookManagerMock);
      await handler(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
      expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });
  });
});
