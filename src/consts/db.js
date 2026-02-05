/**
 * @file src/consts/db.js
 * @description Database (DuckDB) related constants and SQL fragments.
 */
import { getInt } from "../utils/env.js";

export const DUCKDB_STORAGE_DIR_DEFAULT =
  process.env.DUCKDB_STORAGE_DIR ||
  process.env.APIFY_LOCAL_STORAGE_DIR ||
  "./storage";

export const DUCKDB_FILENAME_DEFAULT =
  process.env.DUCKDB_FILENAME || "logs.duckdb";

export const DUCKDB_MEMORY_LIMIT = process.env.DUCKDB_MEMORY_LIMIT || "512MB";
export const DUCKDB_THREADS = getInt("DUCKDB_THREADS", 4);
export const DUCKDB_VACUUM_ENABLED =
  process.env.DUCKDB_VACUUM_ENABLED === "true";
export const DUCKDB_VACUUM_INTERVAL_MS = getInt(
  "DUCKDB_VACUUM_INTERVAL_MS",
  24 * 60 * 60 * 1000,
);
export const DUCKDB_POOL_SIZE = getInt("DUCKDB_POOL_SIZE", 5);

export const SQL_FRAGMENTS = Object.freeze({
  TRUE_CONDITION: "1=1",
});

export const SORT_DIRECTIONS = Object.freeze({
  ASC: "ASC",
  DESC: "DESC",
});

export const SYNC_MAX_CONCURRENT = getInt(
  "SYNC_MAX_CONCURRENT",
  5, // Fallback, initialized in main.js with isAtHome check if needed
);
export const SYNC_MIN_TIME_MS = getInt("SYNC_MIN_TIME_MS", 500);
export const SYNC_BATCH_SIZE = getInt("SYNC_BATCH_SIZE", 1000);

export const DEFAULT_PAGE_LIMIT = getInt("DEFAULT_PAGE_LIMIT", 20);
export const MAX_PAGE_LIMIT = getInt("MAX_PAGE_LIMIT", 10000);
export const DEFAULT_PAGE_OFFSET = getInt("DEFAULT_PAGE_OFFSET", 0);

export const DB_MISSING_OFFSET_MARKER = -1;
