import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
import { fsPromisesMock, constsMock } from "../setup/helpers/shared-mocks.js";
import { assertType } from "../setup/helpers/test-utils.js";

// 1. Mock dependencies
const mockDuckDBConnection = {
  run: jest.fn(),
  runAndReadAll: jest.fn(),
  closeSync: jest.fn(),
  getRowObjects: jest.fn(),
};

const mockDuckDBInstance = {
  connect: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
    mockDuckDBConnection,
  ),
};

const mockDuckDBNodeApi = {
  DuckDBInstance: {
    fromCache: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
      mockDuckDBInstance,
    ),
  },
};

// Use shared fsPromisesMock but registered for "node:fs/promises" manually
// because setupCommonMocks only handles "fs/promises" for now.
jest.unstable_mockModule("node:fs/promises", () => ({
  ...fsPromisesMock,
  default: fsPromisesMock,
}));

jest.unstable_mockModule("node:path", () => ({
  default: {
    join:
      /**
       * @param {any[]} args
       * @returns {string}
       */
      (...args) => args.join("/"),
  },
}));

jest.unstable_mockModule("@duckdb/node-api", () => mockDuckDBNodeApi);

// Setup common mocks (Logger, Consts)
await setupCommonMocks({
  logger: true,
  consts: true,
});

/**
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 * @typedef {import("../../src/db/duckdb.js")} DuckDB
 * @typedef {import("@duckdb/node-api").DuckDBConnection} DuckDBConnection
 */

describe("DuckDB Internal Unit Tests", () => {
  /** @type {DuckDB} */
  let DuckDB;

  beforeEach(async () => {
    jest.clearAllMocks();
    fsPromisesMock.mkdir.mockResolvedValue(assertType(undefined));
    mockDuckDBConnection.run.mockResolvedValue(assertType(undefined));
    mockDuckDBConnection.runAndReadAll.mockResolvedValue(
      assertType({
        getRowObjects: () => [],
      }),
    );

    // Reset consts defaults via shared mock
    Object.defineProperty(constsMock, "DUCKDB_FILENAME", {
      value: "test.db",
      writable: true,
    });

    // Import fresh module for each test
    DuckDB = await import("../../src/db/duckdb.js");
  });

  afterEach(async () => {
    if (DuckDB) await DuckDB.closeDb();
    jest.resetModules();
  });

  describe("getDbInstance", () => {
    test("should handle fs.mkdir errors strictly (not EEXIST)", async () => {
      /** @type {CommonError} */
      const error = new Error("Permission denied");
      error.code = "EACCES";
      fsPromisesMock.mkdir.mockRejectedValueOnce(assertType(error));

      await expect(DuckDB.getDbInstance()).rejects.toThrow("Permission denied");
    });

    test("should ignore EEXIST errors during mkdir", async () => {
      /** @type {CommonError} */
      const error = new Error("Exists");
      error.code = "EEXIST";
      fsPromisesMock.mkdir.mockRejectedValueOnce(assertType(error));

      await expect(DuckDB.getDbInstance()).resolves.toBeDefined();
    });

    test("should skip directory creation if IN_MEM_DB", async () => {
      // Override the mock specifically for this test
      jest.unstable_mockModule("../../src/consts.js", () => ({
        ...constsMock,
        DUCKDB_FILENAME: ":memory:",
      }));

      jest.resetModules();
      DuckDB = await import("../../src/db/duckdb.js");

      await DuckDB.getDbInstance();
      expect(fsPromisesMock.mkdir).not.toHaveBeenCalled();
    });

    test("should initialize schema components", async () => {
      await DuckDB.getDbInstance();

      // Verify table creation
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS logs"),
      );

      // Verify some migrations (ALTER TABLE)
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith(
        expect.stringContaining(
          "ALTER TABLE logs ADD COLUMN IF NOT EXISTS webhookId",
        ),
      );
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith(
        expect.stringContaining(
          "ALTER TABLE logs ADD COLUMN IF NOT EXISTS body JSON",
        ),
      );

      // Verify index creation
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith(
        expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_timestamp"),
      );

      // Verify config
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith(
        expect.stringContaining("SET memory_limit"),
      );
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith(
        expect.stringContaining("SET threads"),
      );
    });
  });

  describe("Connection Pooling", () => {
    test("should reuse connections", async () => {
      // First query triggers DB init (1 connect) + query connect (1 connect)
      await DuckDB.executeQuery("SELECT 1");
      // Second query reuses pooled connection (0 connect)
      await DuckDB.executeQuery("SELECT 1");

      expect(mockDuckDBInstance.connect).toHaveBeenCalledTimes(2);
    });

    test("should close connection if pool is full on release", async () => {
      // Initialize DB first to avoid race condition on initSchema
      await DuckDB.getDbInstance(); // +1 connect, +1 close

      // DUCKDB_POOL_SIZE is 2.
      // Launch 3 queries. They require 3 connections.
      const p1 = DuckDB.executeQuery("SELECT 1");
      const p2 = DuckDB.executeQuery("SELECT 2");
      const p3 = DuckDB.executeQuery("SELECT 3");
      await Promise.all([p1, p2, p3]);

      // Connects: 1 (init) + 3 (queries) = 4
      expect(mockDuckDBInstance.connect).toHaveBeenCalledTimes(4);

      // Closes: 1 (init) + 1 (pool full eviction) = 2
      expect(mockDuckDBConnection.closeSync).toHaveBeenCalledTimes(2);
    });

    test("should execute query with params", async () => {
      await DuckDB.executeQuery("SELECT ?", { val: 1 });
      expect(mockDuckDBConnection.runAndReadAll).toHaveBeenCalledWith(
        "SELECT ?",
        { val: 1 },
      );
    });

    test("should execute query without params", async () => {
      await DuckDB.executeQuery("SELECT 1");
      expect(mockDuckDBConnection.runAndReadAll).toHaveBeenCalledWith(
        "SELECT 1",
      );
    });
  });

  describe("Transaction Handling", () => {
    test("should rollback and throw on task failure", async () => {
      /** @type {jest.MockedFunction<(conn: DuckDBConnection) => Promise<any>>} */
      const task = assertType(jest.fn()).mockRejectedValue(
        assertType(new Error("Task Failed")),
      );
      await expect(DuckDB.executeTransaction(task)).rejects.toThrow(
        "Task Failed",
      );
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith("ROLLBACK");
      // Note: closeSync is called once during getDbInstance's internal schema init
      expect(mockDuckDBConnection.closeSync).toHaveBeenCalledTimes(1);
    });

    test("should log error if rollback fails", async () => {
      mockDuckDBConnection.run.mockImplementation(
        assertType(
          /**
           * @param {string} sql
           * @returns {Promise<void>}
           */
          async (sql) => {
            const trimmedSql = sql.trim().toUpperCase();
            if (trimmedSql === "BEGIN TRANSACTION") return;
            if (trimmedSql === "ROLLBACK") throw new Error("Rollback failed");
            if (
              trimmedSql.startsWith("SET") ||
              trimmedSql.startsWith("CREATE") ||
              trimmedSql.startsWith("ALTER")
            )
              return;
            throw new Error("Primary Action Failed");
          },
        ),
      );

      await expect(
        DuckDB.executeTransaction(async () => {
          throw new Error("Trigger Rollback");
        }),
      ).rejects.toThrow("Trigger Rollback");

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Failed to rollback transaction",
      );
    });

    test("should commit transaction successfully", async () => {
      const result = await DuckDB.executeTransaction(async () => "success");
      expect(result).toBe("success");
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith(
        "BEGIN TRANSACTION",
      );
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith("COMMIT");
    });
  });

  describe("Maintenance Operations", () => {
    test("vacuumDb should run VACUUM and CHECKPOINT", async () => {
      await DuckDB.vacuumDb();
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith("VACUUM");
      expect(mockDuckDBConnection.run).toHaveBeenCalledWith("CHECKPOINT");
      expect(mockDuckDBConnection.closeSync).toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        "Vacuum and checkpoint completed",
      );
    });

    test("closeDb should close all pool connections", async () => {
      await DuckDB.executeQuery("SELECT 1");
      await DuckDB.closeDb();
      expect(mockDuckDBConnection.closeSync).toHaveBeenCalled();
    });

    test("closeDb should close in-use connections", async () => {
      /** @type {any} */
      let resolveAcquired;
      const acquiredP = new Promise((r) => {
        resolveAcquired = r;
      });

      const p = DuckDB.executeTransaction(async () => {
        resolveAcquired();
        await new Promise((r) => setTimeout(r, 50));
      });

      await acquiredP;
      await DuckDB.closeDb();
      await p;
      expect(mockDuckDBConnection.closeSync).toHaveBeenCalled();
    });

    test("closeDb should reset the singleton instance", async () => {
      const inst1 = await DuckDB.getDbInstance();
      expect(mockDuckDBNodeApi.DuckDBInstance.fromCache).toHaveBeenCalledTimes(
        1,
      );

      await DuckDB.closeDb();

      // Subsequent call should trigger a new fromCache call
      const inst2 = await DuckDB.getDbInstance();
      expect(mockDuckDBNodeApi.DuckDBInstance.fromCache).toHaveBeenCalledTimes(
        2,
      );
      // inst1 and inst2 are the same object because our mock returns the same mockDuckDBInstance
      expect(inst1).toBe(inst2);
    });

    test("should return the same instance on sequential calls (Singleton)", async () => {
      const inst1 = await DuckDB.getDbInstance();
      const inst2 = await DuckDB.getDbInstance();
      expect(inst1).toBe(inst2);
      expect(mockDuckDBNodeApi.DuckDBInstance.fromCache).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe("executeWrite", () => {
    test("should execute write operations", async () => {
      await DuckDB.executeWrite("INSERT INTO logs ...");
      expect(mockDuckDBConnection.runAndReadAll).toHaveBeenCalled();
    });

    test("should rethrow on write errors", async () => {
      mockDuckDBConnection.runAndReadAll.mockRejectedValueOnce(
        assertType(new Error("Write Error")),
      );
      await expect(DuckDB.executeWrite("INSERT INTO logs ...")).rejects.toThrow(
        "Write Error",
      );
    });
  });
});
