import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import {
  apifyMock,
  webhookManagerMock,
  logRepositoryMock,
  createKeyValueStoreMock,
  storageHelperMock,
} from "../setup/helpers/shared-mocks.js";

// 1. Setup Common Mocks
await setupCommonMocks({
  apify: true,
  logger: true,
  repositories: true,
  storage: true,
});

const { createLogDetailHandler, createLogPayloadHandler } =
  await import("../../src/routes/logs.js");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 */

describe("Logs Route Details & Payload", () => {
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;

  beforeEach(() => {
    jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

    res = createMockResponse();
    next = createMockNextFunction();

    logRepositoryMock.getLogById.mockReset();
    apifyMock.openKeyValueStore.mockReset();
  });

  describe("Log Detail Handler", () => {
    const handler = () => createLogDetailHandler(webhookManagerMock);

    test("should return 404 if log not found", async () => {
      logRepositoryMock.getLogById.mockResolvedValue(null);
      req = createMockRequest({ params: { logId: "missing" } });

      await handler()(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Log entry not found" }),
      );
    });

    test("should return 404 if webhook ID is invalid", async () => {
      logRepositoryMock.getLogById.mockResolvedValue(
        assertType({
          id: "log_1",
          webhookId: "wh_invalid",
        }),
      );
      jest.mocked(webhookManagerMock.isValid).mockReturnValue(false);
      req = createMockRequest({ params: { logId: "log_1" } });

      await handler()(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Log entry belongs to invalid webhook",
        }),
      );
    });

    test("should return log entry if valid", async () => {
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "log_1",
        webhookId: "wh_1",
        body: "test",
      });
      logRepositoryMock.getLogById.mockResolvedValue(mockLog);
      req = createMockRequest({ params: { logId: "log_1" } });

      await handler()(req, res, next);

      expect(res.json).toHaveBeenCalledWith(mockLog);
    });

    test("should handle field projection and security check", async () => {
      // 1st call: check existence (returns minimal)
      // 2nd call: fetch with fields
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "log_1",
        webhookId: "wh_1",
        method: "POST",
      });

      logRepositoryMock.getLogById
        .mockResolvedValueOnce(mockLog) // Existence check
        .mockResolvedValueOnce(mockLog); // Field fetch

      req = createMockRequest({
        params: { logId: "log_1" },
        query: { fields: "method" },
      });

      await handler()(req, res, next);

      // First call checks existence (default fields?)
      // Second call includes method + webhookId (for security)
      expect(logRepositoryMock.getLogById).toHaveBeenLastCalledWith(
        "log_1",
        expect.arrayContaining(["method", "webhookId"]),
      );

      // Response should NOT include webhookId since it wasn't requested
      expect(res.json).toHaveBeenCalledWith({ id: "log_1", method: "POST" });
    });

    test("should handle race condition where item is deleted between checks", async () => {
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "log_1",
        webhookId: "wh_1",
      });

      logRepositoryMock.getLogById
        .mockResolvedValueOnce(mockLog) // Existence check passes
        .mockResolvedValueOnce(null); // Security check fails (deleted)

      req = createMockRequest({
        params: { logId: "log_1" },
        query: { fields: "method" },
      });

      await handler()(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Log entry not found" }),
      );
    });
  });

  describe("Log Payload Handler", () => {
    const handler = () => createLogPayloadHandler(webhookManagerMock);

    test("should return inline body directly", async () => {
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "log_1",
        webhookId: "wh_1",
        body: { foo: "bar" },
        contentType: "application/json",
      });
      logRepositoryMock.getLogById.mockResolvedValue(mockLog);

      req = createMockRequest({ params: { logId: "log_1" } });

      await handler()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/json",
      );
      expect(res.json).toHaveBeenCalledWith({ foo: "bar" });
    });

    test("should hydrate offloaded payload from KVS", async () => {
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "log_1",
        webhookId: "wh_1",
        body: {
          data: storageHelperMock.OFFLOAD_MARKER_SYNC,
          key: "kvs_key",
        },
        contentType: "text/plain",
      });
      logRepositoryMock.getLogById.mockResolvedValue(mockLog);

      const mockStore = createKeyValueStoreMock({
        getValue: assertType(jest.fn()).mockResolvedValue("Hydrated Content"),
      });
      apifyMock.openKeyValueStore.mockResolvedValue(assertType(mockStore));

      req = createMockRequest({ params: { logId: "log_1" } });

      await handler()(req, res, next);

      expect(mockStore.getValue).toHaveBeenCalledWith("kvs_key");
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/plain");
      expect(res.send).toHaveBeenCalledWith("Hydrated Content");
    });

    test("should return 404 if KVS payload missing", async () => {
      /** @type {LogEntry} */
      const mockLog = assertType({
        id: "log_1",
        webhookId: "wh_1",
        body: {
          data: storageHelperMock.OFFLOAD_MARKER_SYNC,
          key: "kvs_key",
        },
      });
      logRepositoryMock.getLogById.mockResolvedValue(mockLog);

      const mockStore = createKeyValueStoreMock({
        getValue: assertType(jest.fn()).mockResolvedValue(null),
      });
      apifyMock.openKeyValueStore.mockResolvedValue(assertType(mockStore));

      req = createMockRequest({ params: { logId: "log_1" } });

      await handler()(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Payload not found in KVS" }),
      );
    });

    test("should return 500 on repository error", async () => {
      logRepositoryMock.getLogById.mockRejectedValue(new Error("DB Error"));
      req = createMockRequest({ params: { logId: "log_error" } });

      await handler()(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to fetch log payload" }),
      );
    });
  });
});
