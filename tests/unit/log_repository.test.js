import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { assertType } from "../setup/helpers/test-utils.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { duckDbMock } from "../setup/helpers/shared-mocks.js";

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

  describe("findLogsCursor", () => {
    test("should fetch logs with cursor pagination", async () => {
      // Setup mock data
      const mockLogs = Array.from({ length: 11 }, (_, i) => ({
        id: `id_${10 - i}`,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        webhookId: "wh_1",
      }));

      duckDbMock.executeQuery.mockResolvedValue(mockLogs);

      // 1. First Page
      const res1 = await repo.findLogsCursor({ limit: 5, webhookId: "wh_1" });
      expect(res1.items).toHaveLength(5);
      expect(res1.nextCursor).toBeTruthy();
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT $limit"),
        expect.objectContaining({ limit: 6 }), // limit + 1
      );

      // 2. Next Page using cursor
      const nextCursor = res1.nextCursor;
      // Mock next page result
      duckDbMock.executeQuery.mockResolvedValue(mockLogs.slice(5, 11));

      const res2 = await repo.findLogsCursor({
        limit: 5,
        webhookId: "wh_1",
        cursor: assertType(nextCursor),
      });
      expect(res2.items).toHaveLength(5);
      expect(duckDbMock.executeQuery).toHaveBeenLastCalledWith(
        expect.stringContaining("timestamp < $cursorTs"),
        expect.objectContaining({
          cursorTs: expect.any(String),
          cursorId: expect.any(String),
        }),
      );
    });

    test("should handle invalid cursor gracefully", async () => {
      await repo.findLogsCursor({ limit: 5, cursor: "invalid-base64" });
      expect(duckDbMock.executeQuery).toHaveBeenCalled();
      // Should proceed without cursor params
    });
  });

  describe("batchInsertLogs", () => {
    test("should insert logs in transaction", async () => {
      /** @type {LogEntry[]} */
      const logs = assertType([
        { id: "1", timestamp: new Date().toISOString() },
        { id: "2", timestamp: new Date().toISOString() },
      ]);
      await repo.batchInsertLogs(logs);

      // Verify transaction wrapper was called
      expect(duckDbMock.executeTransaction).toHaveBeenCalled();
    });

    test("should do nothing for empty array", async () => {
      await repo.batchInsertLogs([]);
      expect(duckDbMock.executeTransaction).not.toHaveBeenCalled();
    });
  });
});
