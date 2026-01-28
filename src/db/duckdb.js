/**
 * @file src/db/duckdb.js
 * @description DuckDB Singleton and Schema Management using @duckdb/node-api (Neo Client)
 */
import { DuckDBInstance } from "@duckdb/node-api";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DUCKDB_FILENAME,
  DUCKDB_MEMORY_LIMIT,
  DUCKDB_STORAGE_DIR,
  DUCKDB_THREADS,
} from "../consts.js";

/**
 * @typedef {import("@duckdb/node-api").DuckDBValue} DuckDBValue
 * @typedef {import("@duckdb/node-api").DuckDBConnection} DuckDBConnection
 * @typedef {import("../typedefs.js").CommonError} CommonError
 */

/** @type {DuckDBInstance | null} */
let dbInstance = null;

const IN_MEM_DB = ":memory:";
const DB_PATH =
  DUCKDB_FILENAME === IN_MEM_DB
    ? IN_MEM_DB
    : path.join(DUCKDB_STORAGE_DIR, DUCKDB_FILENAME);

/**
 * Validates and gets the DuckDB instance.
 * @returns {Promise<DuckDBInstance>}
 */
export async function getDbInstance() {
  if (dbInstance) return dbInstance;

  if (DB_PATH !== IN_MEM_DB) {
    try {
      await fs.mkdir(DUCKDB_STORAGE_DIR, { recursive: true });
    } catch (err) {
      // Ignore if exists
      if (/** @type {CommonError} */ (err).code !== "EEXIST") {
        throw err;
      }
    }
  }

  // Use Instance Cache pattern
  dbInstance = await DuckDBInstance.fromCache(DB_PATH);

  // Configure
  const conn = await dbInstance.connect();
  try {
    await conn.run(`SET memory_limit='${DUCKDB_MEMORY_LIMIT}'`);
    await conn.run(`SET threads=${DUCKDB_THREADS}`);
    await initSchema(conn);
  } finally {
    conn.closeSync();
  }

  return dbInstance;
}

/**
 * Executes a query and returns all rows as objects.
 * Uses a fresh connection.
 * @param {string} sql - SQL query with named parameters (e.g. $id)
 * @param {Record<string, DuckDBValue>} [params] - Key-value pairs for parameters
 * @returns {Promise<(Record<string, DuckDBValue>)[]>}
 */
export async function executeQuery(sql, params) {
  const instance = await getDbInstance();
  const conn = await instance.connect();
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
    conn.closeSync();
  }
}

/**
 * Initialize Schema
 * @param {DuckDBConnection} conn
 */
async function initSchema(conn) {
  // 1. Create table with baseline schema (minimum viable)
  // If it exists, this does nothing.
  await conn.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id VARCHAR PRIMARY KEY,
      timestamp TIMESTAMP
    );
  `);

  // 2. Ensure all columns exist (Migration / Evolution)
  // DuckDB 'ADD COLUMN IF NOT EXISTS' makes this idempotent.
  const columns = [
    "webhookId VARCHAR",
    "requestId VARCHAR",
    "method VARCHAR",
    "statusCode INTEGER",
    "contentType VARCHAR",
    "processingTime INTEGER",
    "size INTEGER",
    "remoteIp VARCHAR",
    "userAgent VARCHAR",
    "requestUrl VARCHAR",

    // JSON Columns
    "headers JSON",
    "query JSON",
    "body JSON",
    "responseHeaders JSON",
    "responseBody JSON",

    // Metadata
    "signatureValid BOOLEAN",
    "signatureProvider VARCHAR",
    "signatureError VARCHAR",

    // System
    "source_offset BIGINT",
  ];

  for (const colDef of columns) {
    await conn.run(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS ${colDef}`);
  }

  // 3. Create Indexes
  await conn.run(
    "CREATE INDEX IF NOT EXISTS idx_timestamp ON logs (timestamp DESC)",
  );
  await conn.run(
    "CREATE INDEX IF NOT EXISTS idx_statusCode ON logs (statusCode)",
  );
  await conn.run(
    "CREATE INDEX IF NOT EXISTS idx_offset ON logs (source_offset)",
  );
  await conn.run(
    "CREATE INDEX IF NOT EXISTS idx_webhookId ON logs (webhookId)",
  );
  await conn.run(
    "CREATE INDEX IF NOT EXISTS idx_processingTime ON logs (processingTime)",
  );
  await conn.run("CREATE INDEX IF NOT EXISTS idx_method ON logs (method)");
  await conn.run(
    "CREATE INDEX IF NOT EXISTS idx_requestId ON logs (requestId)",
  );
  await conn.run("CREATE INDEX IF NOT EXISTS idx_remoteIp ON logs (remoteIp)");
  await conn.run("CREATE INDEX IF NOT EXISTS idx_size ON logs (size)");
  await conn.run(
    "CREATE INDEX IF NOT EXISTS idx_requestUrl ON logs (requestUrl)",
  );
}

export async function closeDb() {
  // The DuckDB instance is managed by the C++ bindings and usually tied to the process lifecycle.
  // Setting it to null allows the JS wrapper to be garbage collected if needed,
  // but explicit closing of the instance isn't strictly required or always available in the Node bindings
  // beyond closing individual connections (which we do in `executeQuery`).
  dbInstance = null;
}
