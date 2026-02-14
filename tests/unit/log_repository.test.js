import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { assertType } from "../setup/helpers/test-utils.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { duckDbMock, constsMock } from "../setup/helpers/shared-mocks.js";
import { DUCKDB_TABLES } from "../../src/consts/database.js";
import { SORT_DIRECTIONS } from "../../src/consts/app.js";

await setupCommonMocks({ db: true });

const { LogRepository } =
  await import("../../src/repositories/LogRepository.js");

/**
 * @typedef {import("../../src/repositories/LogRepository.js").LogRepository} LogRepositoryType
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 */

describe("LogRepository Unit Tests", () => {
  /** @type {LogRepositoryType} */
  let repo;

  beforeEach(() => {
    repo = new LogRepository();
    jest.clearAllMocks();
  });

  describe("Sorting (#buildOrderBy)", () => {
    test("should use default sort when rules are empty", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({ sort: [] });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY timestamp DESC"),
        expect.any(Object),
      );
    });

    test("should use custom sort rules", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({
        sort: [
          { field: "size", dir: SORT_DIRECTIONS.ASC },
          { field: "statusCode", dir: SORT_DIRECTIONS.DESC },
        ],
      });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          `ORDER BY size ${SORT_DIRECTIONS.ASC}, statusCode ${SORT_DIRECTIONS.DESC}`,
        ),
        expect.any(Object),
      );
    });

    test("should ignore invalid sort fields", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({
        sort: [{ field: "invalid", dir: SORT_DIRECTIONS.ASC }],
      });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(`ORDER BY timestamp ${SORT_DIRECTIONS.DESC}`),
        expect.any(Object),
      );
    });
  });

  describe("Filtering (#buildWhereClause)", () => {
    test("should filter by simple fields", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({
        method: "POST",
        statusCode: constsMock.HTTP_STATUS.OK,
        webhookId: "wh_1",
        requestId: "req_1",
        signatureValid: true,
        signatureProvider: "stripe",
        contentType: "application/json",
        signatureError: "invalid format",
        userAgent: "tester",
        requestUrl: "/api/test",
      });

      const callParams = duckDbMock.executeQuery.mock.calls[0][1];
      expect(callParams).toMatchObject({
        method: "POST",
        statusCode: constsMock.HTTP_STATUS.OK,
        webhookId: "wh_1",
        requestId: "req_1",
        signatureValid: true,
        signatureProvider: "stripe",
        contentType: "%application/json%",
        signatureError: "%invalid format%",
        userAgent: "%tester%",
        requestUrl: "%/api/test%",
      });
    });

    test("should filter by simple statusCode", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({ statusCode: constsMock.HTTP_STATUS.CREATED });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("statusCode = $statusCode"),
        expect.objectContaining({ statusCode: constsMock.HTTP_STATUS.CREATED }),
      );
    });

    test("should filter by signatureValid as false", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({ signatureValid: false });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("signatureValid = $signatureValid"),
        expect.objectContaining({ signatureValid: false }),
      );
    });

    test("should filter by search keyword", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({ search: "test" });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "(id ILIKE $search OR requestUrl ILIKE $search)",
        ),
        expect.objectContaining({ search: "%test%" }),
      );
    });

    test("should filter by CIDR range for remoteIp", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({ remoteIp: "192.168.1.0/24" });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "CAST(remoteIp AS INET) <<= CAST($remoteIp AS INET)",
        ),
        expect.objectContaining({ remoteIp: "192.168.1.0/24" }),
      );
    });

    test("should filter by simple remoteIp", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({ remoteIp: "1.1.1.1" });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("remoteIp = $remoteIp"),
        expect.objectContaining({ remoteIp: "1.1.1.1" }),
      );
    });

    test("should filter by status code range", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({
        statusCode: [
          { operator: "gte", value: constsMock.HTTP_STATUS.BAD_REQUEST },
          {
            operator: "lt",
            value: constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
          },
        ],
      });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "statusCode >= $statusCode_0 AND statusCode < $statusCode_1",
        ),
        expect.objectContaining({
          statusCode_0: constsMock.HTTP_STATUS.BAD_REQUEST,
          statusCode_1: constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
        }),
      );
    });

    test("should filter by JSON fields (body/headers)", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogs({
        body: { type: "payment" },
        headers: "bearer",
      });
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "json_extract_string(body, '$.type') ILIKE $body_key_0",
        ),
        expect.objectContaining({ body_key_0: "%payment%" }),
      );
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "json_extract_string(headers, '$') ILIKE $headers_json_search",
        ),
        expect.objectContaining({ headers_json_search: "%bearer%" }),
      );
    });
  });

  describe("Data Mapping & Transformation", () => {
    test("should fix BigInts in rows", async () => {
      duckDbMock.executeQuery.mockResolvedValue([
        { id: "1", size: BigInt(5000), processingTime: 12.5 },
      ]);
      const { items } = await repo.findLogs({});
      expect(items[0].size).toBe(5000);
      expect(typeof items[0].size).toBe("number");
    });

    test("should parse JSON strings in rows", async () => {
      duckDbMock.executeQuery.mockResolvedValue([
        {
          id: "1",
          headers: '{"content-type":"application/json"}',
          body: '{"foo":"bar"}',
        },
      ]);
      const { items } = await repo.findLogs({});
      expect(items[0].headers).toEqual({ "content-type": "application/json" });
      expect(items[0].body).toEqual({ foo: "bar" });
    });

    test("should handle invalid JSON gracefully", async () => {
      duckDbMock.executeQuery.mockResolvedValue([
        { id: "1", headers: "not-json" },
      ]);
      const { items } = await repo.findLogs({});
      expect(items[0].headers).toBe("not-json"); // Fallback in parseIfPresent
    });
  });

  describe("getLogById", () => {
    test("should fetch by ID with all fields", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ id: "1", method: "GET" }]);
      const log = await repo.getLogById("1");
      expect(log).toBeDefined();
      expect(log?.id).toBe("1");
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(`SELECT * FROM ${DUCKDB_TABLES.LOGS}`),
        { id: "1" },
      );
    });

    test("should fetch by ID with limited fields", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ id: "1", method: "GET" }]);
      await repo.getLogById("1", ["id", "method", "invalid_col"]);
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(`SELECT id, method FROM ${DUCKDB_TABLES.LOGS}`),
        { id: "1" },
      );
    });

    test("should return null if not found", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      const log = await repo.getLogById("unknown");
      expect(log).toBeNull();
    });
  });

  describe("findOffloadedPayloads", () => {
    test("should return keys for offloaded payloads", async () => {
      const webhookId = "wh_123";
      duckDbMock.executeQuery.mockResolvedValue([
        { body: JSON.stringify({ key: "k1", data: "SYNC_MARKER" }) },
        { body: JSON.stringify({ key: "k2", data: "STREAM_MARKER" }) },
        { body: "invalid json" }, // Should be ignored
        { body: JSON.stringify({ other: "data" }) }, // No key, ignored
      ]);

      const keys = await repo.findOffloadedPayloads(webhookId);
      expect(keys).toEqual([{ key: "k1" }, { key: "k2" }]);
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("SELECT body"),
        expect.objectContaining({ webhookId }),
      );
    });
  });

  describe("insertLog", () => {
    test("should insert log with mapped params", async () => {
      /** @type {LogEntry} */
      const log = assertType({
        id: "1",
        url: "http://test",
        timestamp: Date.now().toString(),
      });
      await repo.insertLog(log);
      expect(duckDbMock.executeWrite).toHaveBeenCalledWith(
        expect.stringContaining(`INSERT INTO ${DUCKDB_TABLES.LOGS}`),
        expect.objectContaining({
          id: "1",
          requestUrl: "http://test",
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe("batchInsertLogs", () => {
    test("should use transaction for multiple logs", async () => {
      /** @type {LogEntry[]} */
      const logs = assertType([
        { id: "1", timestamp: Date.now().toString() },
        { id: "2", timestamp: Date.now().toString() },
      ]);

      const connMock = { run: jest.fn().mockResolvedValue(assertType({})) };
      duckDbMock.executeTransaction.mockImplementation(async (cb) =>
        cb(connMock),
      );

      await repo.batchInsertLogs(logs);

      expect(duckDbMock.executeTransaction).toHaveBeenCalled();
      expect(connMock.run).toHaveBeenCalledTimes(2);
    });

    test("should do nothing for empty array", async () => {
      await repo.batchInsertLogs([]);
      expect(duckDbMock.executeTransaction).not.toHaveBeenCalled();
    });
  });

  describe("deleteLogsByWebhookId", () => {
    test("should delete logs", async () => {
      await repo.deleteLogsByWebhookId("wh_1");
      expect(duckDbMock.executeWrite).toHaveBeenCalledWith(
        expect.stringContaining(
          `DELETE FROM ${DUCKDB_TABLES.LOGS} WHERE webhookId = $webhookId`,
        ),
        { webhookId: "wh_1" },
      );
    });
  });

  describe("Pagination (findLogsCursor)", () => {
    test("should use cursor condition if provided", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      const cursor = Buffer.from("2026-01-01T00:00:00.000Z:id_123").toString(
        "base64",
      );

      await repo.findLogsCursor({ limit: 10, cursor });

      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "AND (timestamp < $cursorTs OR (timestamp = $cursorTs AND id < $cursorId))",
        ),
        expect.objectContaining({
          cursorTs: "2026-01-01T00:00:00.000Z",
          cursorId: "id_123",
          limit: 11,
        }),
      );
    });

    test("should handle malformed cursor", async () => {
      duckDbMock.executeQuery.mockResolvedValue([]);
      await repo.findLogsCursor({ limit: 10, cursor: "not-base64-!!!" });
      expect(duckDbMock.executeQuery).toHaveBeenCalled();
    });

    test("should generate nextCursor if hasMore", async () => {
      const mockRows = Array.from({ length: 11 }, (_, i) => ({
        id: `id_${i}`,
        timestamp: "2026-01-01T00:00:00.000Z",
      }));
      duckDbMock.executeQuery.mockResolvedValue(mockRows);

      const result = await repo.findLogsCursor({ limit: 10 });
      expect(result.items).toHaveLength(10);
      expect(result.nextCursor).toBeDefined();
      const decoded = Buffer.from(
        assertType(result.nextCursor),
        "base64",
      ).toString("utf-8");
      expect(decoded).toBe("2026-01-01T00:00:00.000Z:id_9");
    });
  });
});
