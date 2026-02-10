/**
 * @file src/db/duckdb.js
 * @description DuckDB Singleton and Schema Management using @duckdb/node-api (Neo Client)
 * @module db/duckdb
 */
import { DuckDBInstance } from "@duckdb/node-api";
import fs from "node:fs/promises";
import path from "node:path";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import {
  DUCKDB_CONSTS,
  DUCKDB_TABLES,
  DUCKDB_SCHEMA,
  DUCKDB_FILENAME_DEFAULT,
  DUCKDB_MEMORY_LIMIT,
  DUCKDB_POOL_SIZE,
  DUCKDB_STORAGE_DIR_DEFAULT,
  DUCKDB_THREADS,
  SQL_CONSTS,
} from "../consts/database.js";
import { ENV_VARS } from "../consts/app.js";
import { NODE_ERROR_CODES } from "../consts/errors.js";
import { createChildLogger } from "../utils/logger.js";
import Bottleneck from "bottleneck";

const log = createChildLogger({ component: LOG_COMPONENTS.DUCKDB });

// Serialize all write operations to prevent "Database Locked" errors
// and ensure sequential processing of mutations.
const writeQueue = new Bottleneck({
  maxConcurrent: 1,
});

/**
 * @typedef {import("@duckdb/node-api").DuckDBValue} DuckDBValue
 * @typedef {import("@duckdb/node-api").DuckDBConnection} DuckDBConnection
 * @typedef {import("../typedefs.js").CommonError} CommonError
 */

/** @type {DuckDBInstance | null} */
let dbInstance = null;
/** @type {Promise<DuckDBInstance> | null} */
let initPromise = null;

/** @type {DuckDBConnection[]} */
const connectionPool = [];

/** @type {DuckDBConnection[]} */
const inUseConnections = [];

const IN_MEM_DB = DUCKDB_CONSTS.MEMORY_DB;

/**
 * Gets the current database path based on environment variables.
 * @returns {string}
 */
function getDbPath() {
  const storageDir =
    process.env[ENV_VARS.DUCKDB_STORAGE_DIR] || DUCKDB_STORAGE_DIR_DEFAULT;
  const filename =
    process.env[ENV_VARS.DUCKDB_FILENAME] || DUCKDB_FILENAME_DEFAULT;
  return filename === IN_MEM_DB ? IN_MEM_DB : path.join(storageDir, filename);
}

/**
 * Validates and gets the DuckDB instance.
 * @returns {Promise<DuckDBInstance>}
 */
export async function getDbInstance() {
  if (dbInstance) return dbInstance;

  if (!initPromise) {
    initPromise = (async () => {
      const dbPath = getDbPath();
      const storageDir =
        process.env[ENV_VARS.DUCKDB_STORAGE_DIR] || DUCKDB_STORAGE_DIR_DEFAULT;

      if (dbPath !== IN_MEM_DB) {
        try {
          await fs.mkdir(storageDir, { recursive: true });
        } catch (err) {
          // Ignore if exists
          if (
            /** @type {CommonError} */ (err).code !== NODE_ERROR_CODES.EEXIST
          ) {
            throw err;
          }
        }
      }

      // Use Instance Cache pattern
      const instance = await DuckDBInstance.fromCache(dbPath);

      // Configure
      const conn = await instance.connect();
      try {
        await conn.run(`SET memory_limit='${DUCKDB_MEMORY_LIMIT}'`);
        await conn.run(`SET threads=${DUCKDB_THREADS}`);
        await initSchema(conn);
      } finally {
        conn.closeSync();
      }

      dbInstance = instance;
      return instance;
    })();
  }

  return initPromise;
}

/**
 * Resets the DuckDB singleton instance (primarily for tests).
 * @returns {Promise<void>}
 */
export async function resetDbInstance() {
  dbInstance = null;
  initPromise = null;
  connectionPool.length = 0;
  inUseConnections.length = 0;
}

/**
 * Acquires a connection from the pool or creates a new one.
 * @returns {Promise<DuckDBConnection>}
 */
async function acquireConnection() {
  const instance = await getDbInstance();

  // Try to get from pool
  const pooledConn = connectionPool.pop();
  if (pooledConn) {
    inUseConnections.push(pooledConn);
    return pooledConn;
  }

  // Create new connection
  const newConn = await instance.connect();
  inUseConnections.push(newConn);
  return newConn;
}

/**
 * Releases a connection back to the pool or closes it if pool is full.
 * @param {DuckDBConnection} conn
 * @returns {void}
 */
function releaseConnection(conn) {
  const idx = inUseConnections.indexOf(conn);
  if (idx !== -1) {
    inUseConnections.splice(idx, 1);
  }

  if (connectionPool.length < DUCKDB_POOL_SIZE) {
    connectionPool.push(conn);
  } else {
    conn.closeSync();
  }
}

/**
 * Executes a query and returns all rows as objects.
 * Uses connection pooling for efficiency.
 * @param {string} sql - SQL query with named parameters (e.g. $id)
 * @param {Record<string, DuckDBValue>} [params] - Key-value pairs for parameters
 * @returns {Promise<(Record<string, DuckDBValue>)[]>}
 */
export async function executeQuery(sql, params) {
  const conn = await acquireConnection();
  try {
    let reader;
    if (params) {
      // runAndReadAll supports params object as second argument
      reader = await conn.runAndReadAll(sql, params);
    } else {
      reader = await conn.runAndReadAll(sql);
    }
    return reader.getRowObjects();
  } finally {
    releaseConnection(conn);
  }
}

/**
 * Executes a write query (INSERT, UPDATE, DELETE) through the sequential write queue.
 * @param {string} sql
 * @param {Record<string, DuckDBValue>} [params]
 * @returns {Promise<void>}
 */
export async function executeWrite(sql, params) {
  return writeQueue.schedule(async () => {
    // We can reuse executeQuery since it handles the connection lifecycle.
    // The value addition here is the queue scheduling.
    await executeQuery(sql, params);
  });
}

/**
 * Executes a function within a transaction, serialized by the write queue.
 * Handles BEGIN, COMMIT, and ROLLBACK automatically.
 * @template T
 * @param {(conn: DuckDBConnection) => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function executeTransaction(task) {
  return writeQueue.schedule(async () => {
    const conn = await acquireConnection();
    try {
      await conn.run(SQL_CONSTS.TRANSACTION_COMMANDS.BEGIN);
      const result = await task(conn);
      await conn.run(SQL_CONSTS.TRANSACTION_COMMANDS.COMMIT);
      return result;
    } catch (err) {
      try {
        await conn.run(SQL_CONSTS.TRANSACTION_COMMANDS.ROLLBACK);
      } catch (rollbackErr) {
        log.error(
          { err: rollbackErr },
          LOG_MESSAGES.TRANSACTION_ROLLBACK_FAILED,
        );
      }
      throw err;
    } finally {
      releaseConnection(conn);
    }
  });
}

/**
 * Initialize Schema
 * @param {DuckDBConnection} conn
 * @returns {Promise<void>}
 */
async function initSchema(conn) {
  // 1. Create table with baseline schema (minimum viable)
  // If it exists, this does nothing.
  await conn.run(`
    CREATE TABLE IF NOT EXISTS ${DUCKDB_TABLES.LOGS} (
      ${SQL_CONSTS.COLUMNS.ID} VARCHAR PRIMARY KEY,
      ${SQL_CONSTS.COLUMNS.TIMESTAMP} TIMESTAMP
    );
  `);

  // 2. Ensure all columns exist (Migration / Evolution)
  // DuckDB 'ADD COLUMN IF NOT EXISTS' makes this idempotent.
  const columns = DUCKDB_SCHEMA.COLUMNS;

  for (const colDef of columns) {
    await conn.run(
      `ALTER TABLE ${DUCKDB_TABLES.LOGS} ADD COLUMN IF NOT EXISTS ${colDef}`,
    );
  }

  // 3. Create Indexes
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.TIMESTAMP} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.TIMESTAMP} DESC)`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.STATUS_CODE} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.STATUS_CODE})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.SOURCE_OFFSET} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.SOURCE_OFFSET})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.WEBHOOK_ID} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.WEBHOOK_ID})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.PROCESSING_TIME} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.PROCESSING_TIME})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.METHOD} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.METHOD})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.REQUEST_ID} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.REQUEST_ID})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.REMOTE_IP} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.REMOTE_IP})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.SIZE} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.SIZE})`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_${SQL_CONSTS.COLUMNS.REQUEST_URL} ON ${DUCKDB_TABLES.LOGS} (${SQL_CONSTS.COLUMNS.REQUEST_URL})`,
  );
}

/**
 * @returns {Promise<void>}
 */
export async function closeDb() {
  // Drain connection pool
  while (connectionPool.length > 0) {
    connectionPool.pop()?.closeSync();
  }
  while (inUseConnections.length > 0) {
    inUseConnections.pop()?.closeSync();
  }
  dbInstance = null;
  initPromise = null;
}

/**
 * Runs VACUUM and CHECKPOINT to reclaim space after bulk deletes.
 * Useful for long-running self-hosted instances with high data churn.
 * @returns {Promise<void>}
 */
export async function vacuumDb() {
  const instance = await getDbInstance();
  const conn = await instance.connect();
  try {
    await conn.run(SQL_CONSTS.TRANSACTION_COMMANDS.VACUUM);
    await conn.run(SQL_CONSTS.TRANSACTION_COMMANDS.CHECKPOINT);
    log.info(LOG_MESSAGES.VACUUM_COMPLETE);
  } finally {
    conn.closeSync();
  }
}
