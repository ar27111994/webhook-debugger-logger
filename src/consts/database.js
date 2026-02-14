/**
 * @file src/consts/database.js
 * @description Database schema, tables, and query constants.
 * @module consts/database
 */

import { Actor } from "apify";
import { getInt } from "../utils/env.js";
import { APP_CONSTS, SORT_DIRECTIONS } from "./app.js";
import { DEFAULT_STORAGE_DIR } from "./storage.js";
import { ENV_VARS } from "./app.js";

export const DUCKDB_STORAGE_DIR_DEFAULT = DEFAULT_STORAGE_DIR;

export const DUCKDB_FILENAME_DEFAULT =
  process.env[ENV_VARS.DUCKDB_FILENAME] || "logs.duckdb";

export const DUCKDB_MEMORY_LIMIT =
  process.env[ENV_VARS.DUCKDB_MEMORY_LIMIT] || "512MB";
export const DUCKDB_THREADS = getInt("DUCKDB_THREADS", 4);
export const DUCKDB_VACUUM_ENABLED =
  process.env[ENV_VARS.DUCKDB_VACUUM_ENABLED] === "true";
export const DUCKDB_VACUUM_INTERVAL_MS = getInt(
  "DUCKDB_VACUUM_INTERVAL_MS",
  24 * 60 * 60 * APP_CONSTS.MS_PER_SECOND,
);
export const DUCKDB_POOL_SIZE = getInt("DUCKDB_POOL_SIZE", 5);

export const SYNC_MAX_CONCURRENT = getInt(
  "SYNC_MAX_CONCURRENT",
  Actor.isAtHome() ? 1 : 5,
);
export const SYNC_MIN_TIME_MS = getInt("SYNC_MIN_TIME_MS", 500);
export const SYNC_BATCH_SIZE = getInt("SYNC_BATCH_SIZE", 1000);

export const DB_MISSING_OFFSET_MARKER = -1;
export const PAGINATION_CONSTS = Object.freeze({
  DEFAULT_PAGE_LIMIT: getInt("DEFAULT_PAGE_LIMIT", 100),
  MAX_PAGE_LIMIT: getInt("MAX_PAGE_LIMIT", 10000),
  DEFAULT_PAGE_OFFSET: getInt("DEFAULT_PAGE_OFFSET", 0),
});

/**
 * @type {Readonly<{MEMORY_DB: string}>}
 */
export const DUCKDB_CONSTS = Object.freeze({
  MEMORY_DB: ":memory:",
});

/**
 * @enum {string}
 */
export const DUCKDB_TABLES = Object.freeze({
  LOGS: "logs",
});

/**
 * @enum {string}
 */
export const SQL_FRAGMENTS = Object.freeze({
  TRUE_CONDITION: "1=1",
});

export const SQL_CONSTS = Object.freeze({
  /** @type {string[]} */
  VALID_OPERATORS: ["gt", "gte", "lt", "lte", "ne", "eq"],
  /** @enum {string} */
  OPERATORS: Object.freeze({
    GT: "gt",
    GTE: "gte",
    LT: "lt",
    LTE: "lte",
    NE: "ne",
    EQ: "eq",
  }),
  /** @enum {string} */
  COLUMNS: Object.freeze({
    TIMESTAMP: "timestamp",
    ID: "id",
    WEBHOOK_ID: "webhookId",
    CONTENT_TYPE: "contentType",
    STATUS_CODE: "statusCode",
    METHOD: "method",
    SIZE: "size",
    REMOTE_IP: "remoteIp",
    USER_AGENT: "userAgent",
    REQUEST_URL: "requestUrl",
    HEADERS: "headers",
    QUERY: "query",
    BODY: "body",
    RESPONSE_HEADERS: "responseHeaders",
    RESPONSE_BODY: "responseBody",
    SIGNATURE_VALID: "signatureValid",
    SIGNATURE_PROVIDER: "signatureProvider",
    SIGNATURE_ERROR: "signatureError",
    REQUEST_ID: "requestId",
    PROCESSING_TIME: "processingTime",
    SOURCE_OFFSET: "source_offset",
    BODY_ENCODING: "bodyEncoding",
  }),
  /** @type {readonly string[]} */
  ALL_LOG_COLUMNS: Object.freeze([
    "id",
    "webhookId",
    "timestamp",
    "method",
    "statusCode",
    "size",
    "remoteIp",
    "userAgent",
    "requestUrl",
    "headers",
    "query",
    "body",
    "responseHeaders",
    "responseBody",
    "signatureValid",
    "signatureProvider",
    "signatureError",
    "requestId",
    "processingTime",
    "contentType",
    "source_offset",
    "bodyEncoding",
  ]),
  /** @type {Record<string, string>} */
  OPERATOR_MAP: Object.freeze({
    eq: "=",
    ne: "!=",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  }),
  /** @enum {string} */
  TRANSACTION_COMMANDS: {
    BEGIN: "BEGIN TRANSACTION",
    COMMIT: "COMMIT",
    ROLLBACK: "ROLLBACK",
    VACUUM: "VACUUM",
    CHECKPOINT: "CHECKPOINT",
  },
});

export const SQL_FUNCTIONS = Object.freeze({
  JSON_EXTRACT_STRING: "json_extract_string",
});

export const DUCKDB_SCHEMA = Object.freeze({
  COLUMNS: [
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
    "bodyEncoding VARCHAR",
    "headers JSON",
    "query JSON",
    "body JSON",
    "responseHeaders JSON",
    "responseBody JSON",
    "signatureValid BOOLEAN",
    "signatureProvider VARCHAR",
    "signatureError VARCHAR",
    "source_offset BIGINT",
  ],
});

export const DEFAULT_SORT = Object.freeze([
  SQL_CONSTS.COLUMNS.TIMESTAMP,
  SORT_DIRECTIONS.DESC,
]);
