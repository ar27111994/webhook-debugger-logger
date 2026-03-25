/**
 * @file tests/unit/db/duckdb.test.js
 * @description Unit tests for DuckDB Singleton and Connection Management.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import {
  loggerMock,
  fsPromisesMock,
} from "../../setup/helpers/shared-mocks.js";
import { DuckDBInstance } from "@duckdb/node-api";
import { ENV_VARS } from "../../../src/consts/app.js";
import { NODE_ERROR_CODES } from "../../../src/consts/errors.js";
import { assertType } from "../../setup/helpers/test-utils.js";

// Import LOG_MESSAGES for assertions
const { LOG_MESSAGES } = await import("../../../src/consts/messages.js");

await setupCommonMocks({
  logger: true,
  fs: true,
  consts: true,
});

// Import subject AFTER mocking
const {
  getDbInstance,
  resetDbInstance,
  executeQuery,
  executeWrite,
  executeTransaction,
  closeDb,
  vacuumDb,
} = await import("../../../src/db/duckdb.js");

const { DUCKDB_CONSTS, DUCKDB_TABLES } =
  await import("../../../src/consts/database.js");

/**
 * @typedef {import("@duckdb/node-api").DuckDBConnection} DuckDBConnection
 * @typedef {import("../../../src/typedefs.js").CommonError} CommonError
 */

describe("DuckDB Singleton", () => {
  const ITERATIONS_FOR_POOL = 10;
  const POLL_INTERVAL_MS = 10;
  const MAX_POLLS = 100;
  const SELECT_ONE_SQL = "SELECT 1 as val";
  const SELECT_TWO_SQL = "SELECT 2 as val";

  beforeEach(async () => {
    await resetDbInstance();
    jest.clearAllMocks();

    // Mock fs.mkdir success by default
    fsPromisesMock.mkdir.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await resetDbInstance();

    // Ensure env vars are reset to test values after each test
    // (tests may have modified DUCKDB_FILENAME)
    process.env[ENV_VARS.DUCKDB_FILENAME] = DUCKDB_CONSTS.MEMORY_DB;
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("getDbInstance", () => {
    it("should initialize a new DuckDB instance and cache it", async () => {
      const instance1 = await getDbInstance();
      const instance2 = await getDbInstance();

      expect(instance1).toBeDefined();
      expect(instance1).toBe(instance2);
    });

    it("should handle concurrent initialization", async () => {
      await resetDbInstance();
      const p1 = getDbInstance();
      const p2 = getDbInstance();
      const [i1, i2] = await Promise.all([p1, p2]);
      expect(i1).toBe(i2);
      expect(i1).toBeDefined();
    });

    it("should create storage directory if not in memory", async () => {
      process.env[ENV_VARS.DUCKDB_FILENAME] = "test.db";

      const spy = jest.spyOn(DuckDBInstance, "fromCache");
      spy.mockResolvedValue(
        await DuckDBInstance.create(DUCKDB_CONSTS.MEMORY_DB),
      );

      await getDbInstance();

      expect(fsPromisesMock.mkdir).toHaveBeenCalledWith(
        process.env[ENV_VARS.DUCKDB_STORAGE_DIR],
        { recursive: true },
      );

      spy.mockRestore();
    });

    it("should ignore EEXIST error during directory creation", async () => {
      process.env[ENV_VARS.DUCKDB_FILENAME] = "test.db";
      /** @type {CommonError} */
      const error = new Error("exists");
      error.code = NODE_ERROR_CODES.EEXIST;
      fsPromisesMock.mkdir.mockRejectedValue(error);

      const spy = jest.spyOn(DuckDBInstance, "fromCache");
      spy.mockResolvedValue(
        await DuckDBInstance.create(DUCKDB_CONSTS.MEMORY_DB),
      );

      await expect(getDbInstance()).resolves.toBeDefined();

      spy.mockRestore();
    });

    it("should throw non-EEXIST errors during directory creation", async () => {
      process.env[ENV_VARS.DUCKDB_FILENAME] = "test.db";
      /** @type {CommonError} */
      const error = new Error("perm");
      error.code = "EPERM";
      fsPromisesMock.mkdir.mockRejectedValue(error);

      await expect(getDbInstance()).rejects.toThrow();
    });

    it("should handle default environment variables", async () => {
      const originalDuckDbFilename = process.env[ENV_VARS.DUCKDB_FILENAME];
      const originalDuckDbStorageDir = process.env[ENV_VARS.DUCKDB_STORAGE_DIR];
      try {
        delete process.env[ENV_VARS.DUCKDB_FILENAME];
        delete process.env[ENV_VARS.DUCKDB_STORAGE_DIR];

        const spy = jest.spyOn(DuckDBInstance, "fromCache");
        spy.mockResolvedValue(
          await DuckDBInstance.create(DUCKDB_CONSTS.MEMORY_DB),
        );

        await getDbInstance();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
      } finally {
        process.env[ENV_VARS.DUCKDB_FILENAME] = originalDuckDbFilename;
        process.env[ENV_VARS.DUCKDB_STORAGE_DIR] = originalDuckDbStorageDir;
      }
    });
  });

  describe("executeQuery", () => {
    it("should execute a simple query and return results", async () => {
      const rows = await executeQuery("SELECT 42 as val");
      expect(rows).toEqual([{ val: 42 }]);
    });

    it("should handle parameterized queries", async () => {
      const rows = await executeQuery("SELECT $val as val", { val: 100 });
      expect(rows).toEqual([{ val: 100 }]);
    });

    it("should create a fresh connection after closeDb invalidates pooled handles", async () => {
      const firstInstance = await getDbInstance();
      const firstConnectSpy = jest.spyOn(firstInstance, "connect");

      const FIRST_QUERY_CONNECT_COUNT = 1;
      const warmupRows = await executeQuery(SELECT_ONE_SQL);
      expect(warmupRows).toEqual([{ val: 1 }]);
      expect(firstConnectSpy).toHaveBeenCalledTimes(FIRST_QUERY_CONNECT_COUNT);

      await closeDb();

      const secondInstance = await getDbInstance();
      const secondConnectSpy = jest.spyOn(secondInstance, "connect");
      const nextRows = await executeQuery(SELECT_TWO_SQL);
      expect(nextRows).toEqual([{ val: 2 }]);
      expect(secondConnectSpy).toHaveBeenCalledTimes(FIRST_QUERY_CONNECT_COUNT);
    });

    it("should handle connection pooling limits", async () => {
      await resetDbInstance();
      const instance = await getDbInstance();
      const connectSpy = jest.spyOn(instance, "connect");

      // Run iterations sequentially - should reuse 1 connection
      for (let i = 0; i < ITERATIONS_FOR_POOL; i++) {
        const rows = await executeQuery(SELECT_ONE_SQL);
        expect(rows[0].val).toBe(1);
      }

      // Since it's sequential, only 1 connect should happen
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it("should close extra connections when pool is full", async () => {
      /** @type {DuckDBConnection[]} */
      const connections = [];

      const originalConnect = DuckDBInstance.prototype.connect;
      /** @this {DuckDBInstance} */
      const connectSpy = jest
        .spyOn(DuckDBInstance.prototype, "connect")
        .mockImplementation(
          /** @this {DuckDBInstance} */
          async function () {
            const conn = await originalConnect.call(this);
            jest.spyOn(conn, "closeSync");
            connections.push(conn);
            return conn;
          },
        );

      await resetDbInstance();
      await getDbInstance();

      // initialization uses 1 connection and closes it
      const INIT_CONNECT_COUNT = 1;
      expect(connectSpy).toHaveBeenCalledTimes(INIT_CONNECT_COUNT);

      // Run 3 parallel queries.
      // Default pool size in shared-mocks is 2.
      const PARALLEL_QUERIES = 3;
      const p1 = executeQuery("SELECT 1");
      const p2 = executeQuery("SELECT 1");
      const p3 = executeQuery("SELECT 1");

      await Promise.all([p1, p2, p3]);

      // connect should have been called 3 more times (total 4)
      const TOTAL_CONNECT_COUNT = INIT_CONNECT_COUNT + PARALLEL_QUERIES;
      expect(connectSpy).toHaveBeenCalledTimes(TOTAL_CONNECT_COUNT);

      // connection count: 1 (init) + 3 (queries) = 4 total.
      // init conn closed manually (1).
      // q1, q2 released to pool (0 closed).
      // q3 closed because pool full (1 closed).
      // Total closed should be 2.
      const EXPECTED_CLOSED_COUNT = 2;
      const closedCount = connections.filter(
        (c) => jest.mocked(c.closeSync).mock.calls.length > 0,
      ).length;
      expect(closedCount).toBe(EXPECTED_CLOSED_COUNT);
    });

    it("should discard unusable pooled connections and open a fresh one", async () => {
      const instance = await getDbInstance();
      const connectSpy = jest.spyOn(instance, "connect");

      // Warm up: create and release one pooled connection.
      await executeQuery(SELECT_ONE_SQL);

      const fakeStaleConn = {
        run: jest.fn(async () => {
          throw new Error("stale pooled connection");
        }),
        closeSync: jest.fn(),
      };

      // First pop returns a stale connection object while still consuming one
      // actual pooled slot. acquireConnection() should discard it and open fresh.
      const popSpy = jest
        .spyOn(Array.prototype, "pop")
        .mockImplementationOnce(() => fakeStaleConn);

      await executeQuery(SELECT_ONE_SQL);

      expect(fakeStaleConn.closeSync).toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalled();
      popSpy.mockRestore();
    });

    it("should handle defensive undefined pops from the pool without crashing", async () => {
      await getDbInstance();
      await executeQuery(SELECT_ONE_SQL); // populate pool

      const popSpy = jest
        .spyOn(Array.prototype, "pop")
        .mockImplementationOnce(() => undefined);

      await expect(executeQuery(SELECT_ONE_SQL)).resolves.toEqual([{ val: 1 }]);
      popSpy.mockRestore();
    });
  });

  describe("executeWrite", () => {
    it("should serialize writes using the queue", async () => {
      await executeQuery("CREATE TABLE writes (id INTEGER)");

      const promises = [
        executeWrite("INSERT INTO writes VALUES (1)"),
        executeWrite("INSERT INTO writes VALUES (2)"),
        executeWrite("INSERT INTO writes VALUES (3)"),
      ];

      await Promise.all(promises);

      const rows = await executeQuery("SELECT id FROM writes ORDER BY id");
      expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });
  });

  describe("executeTransaction", () => {
    beforeEach(async () => {
      await executeQuery("CREATE TABLE tx_test (val TEXT)");
    });

    it("should commit successful transactions", async () => {
      await executeTransaction(
        /**
         * @param {DuckDBConnection} conn
         * @returns {Promise<void>}
         */
        async (conn) => {
          await conn.run("INSERT INTO tx_test VALUES ('success')");
        },
      );

      const rows = await executeQuery("SELECT * FROM tx_test");
      expect(rows).toEqual([{ val: "success" }]);
    });

    it("should rollback failed transactions", async () => {
      const errorMessage = "TX_FAILURE";
      /**
       * @param {DuckDBConnection} conn
       * @returns {Promise<void>}
       */
      const failingTask = async (conn) => {
        await conn.run("INSERT INTO tx_test VALUES ('fail')");
        throw new Error(errorMessage);
      };

      await expect(executeTransaction(failingTask)).rejects.toThrow(
        errorMessage,
      );

      const rows = await executeQuery("SELECT * FROM tx_test");
      expect(rows).toEqual([]);
    });

    it("should log error if rollback fails", async () => {
      const errorMessage = "TX_FAILURE";
      /**
       * @param {DuckDBConnection} conn
       * @returns {Promise<void>}
       */
      const weirdTask = async (conn) => {
        await conn.run("COMMIT");
        throw new Error(errorMessage);
      };

      await expect(executeTransaction(weirdTask)).rejects.toThrow(errorMessage);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        LOG_MESSAGES.TRANSACTION_ROLLBACK_FAILED,
      );
    });
  });

  describe("vacuumDb", () => {
    it("should execute VACUUM and CHECKPOINT", async () => {
      await vacuumDb();
      expect(loggerMock.info).toHaveBeenCalledWith(
        LOG_MESSAGES.VACUUM_COMPLETE,
      );
    });
  });

  describe("closeDb", () => {
    it("should drain connection pool including in-use ones", async () => {
      const instance = await getDbInstance();
      /** @type {DuckDBConnection[]} */
      const connections = [];
      const originalConnect = instance.connect.bind(instance);

      jest.spyOn(instance, "connect").mockImplementation(async () => {
        const conn = await originalConnect();
        jest.spyOn(conn, "closeSync");
        connections.push(conn);
        return conn;
      });

      let started = false;
      let txResolver = () => {};
      const txPromise = new Promise((resolve) => {
        txResolver = assertType(resolve);
      });

      const txHandler = executeTransaction(async () => {
        started = true;
        await txPromise;
      });

      for (let i = 0; i < MAX_POLLS && !started; i++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      expect(started).toBe(true);

      // One connection is inUse (tx), one might be in pool if we did previous tests
      await closeDb();

      // Verify all connections encountered so far are closed
      for (const conn of connections) {
        expect(conn.closeSync).toHaveBeenCalled();
      }

      txResolver();
      await txHandler.catch(() => {});
    });

    it("should tolerate close errors from stale connections", async () => {
      const instance = await getDbInstance();
      const originalConnect = instance.connect.bind(instance);

      jest.spyOn(instance, "connect").mockImplementation(async () => {
        const conn = await originalConnect();
        jest.spyOn(conn, "closeSync").mockImplementation(() => {
          throw new Error("stale handle");
        });
        return conn;
      });

      // One query to populate pool with a connection that throws on close.
      await executeQuery(SELECT_ONE_SQL);

      await expect(closeDb()).resolves.not.toThrow();
    });

    it("should safely handle undefined pops while draining pooled connections", async () => {
      await getDbInstance();
      await executeQuery(SELECT_ONE_SQL); // populate connection pool

      const originalPop = Array.prototype.pop;
      const popSpy = jest.spyOn(Array.prototype, "pop").mockImplementationOnce(
        /** @this {unknown[]} */
        function () {
          // Preserve native length mutation so the closeDb loop can terminate,
          // but return undefined to exercise the defensive close path.
          originalPop.call(this);
          return undefined;
        },
      );

      await expect(closeDb()).resolves.not.toThrow();
      popSpy.mockRestore();
    });
  });

  describe("initSchema idempotency", () => {
    it("should handle re-initialization gracefully", async () => {
      const rows = await executeQuery(
        `SELECT count(*) as total FROM ${DUCKDB_TABLES.LOGS}`,
      );
      expect(Number(rows[0].total)).toBe(0);
    });
  });
});
