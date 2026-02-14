/**
 * @file src/consts/app.js
 * @description Application defaults, ID configurations, and lifecycle timeouts.
 * @module consts/app
 */
import { createRequire } from "module";
import { getInt } from "../utils/env.js";

const require = createRequire(import.meta.url);
const actorJson = require("../../.actor/actor.json");
const inputSchema = require("../../.actor/input_schema.json");

export const DEFAULT_ID_LENGTH = getInt("DEFAULT_ID_LENGTH", 21);
export const WEBHOOK_ID_PREFIX = "wh_";
export const REQUEST_ID_PREFIX = "req_";
export const MAX_SSE_CLIENTS = getInt("MAX_SSE_CLIENTS", 100);

export const EVENT_MAX_LISTENERS = getInt("EVENT_MAX_LISTENERS", 20);

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  FAILURE: 1,
});

export const EXPRESS_SETTINGS = Object.freeze({
  TRUST_PROXY: "trust proxy",
});

export const APP_CONSTS = Object.freeze({
  SERVICE_NAME: actorJson.name,
  STARTUP_ID_PREFIX: "startup-",
  UNKNOWN: "unknown",
  KEY_SEPARATOR: ":",
  MS_PER_HOUR: 60 * 60 * 1000,
  MS_PER_SECOND: 1000,
  BYTES_PER_KB: 1024,
  JSON_INDENT: getInt("JSON_INDENT", 2),
  BASE_URL_TEMPLATE: "${protocol}://${host}${baseUrl}",
  DEFAULT_ID_LENGTH,
  MAX_SSE_CLIENTS,
  APIFY_HOMEPAGE_URL: process.env.APIFY_HOMEPAGE_URL || actorJson.homepageUrl,
  BACKGROUND_TASK_TIMEOUT_PROD_MS: getInt(
    "BACKGROUND_TASK_TIMEOUT_PROD_MS",
    10000,
  ),
  ALERT_TIMEOUT_MS: getInt("ALERT_TIMEOUT_MS", 5000),
  BACKGROUND_TASK_TIMEOUT_TEST_MS: getInt(
    "BACKGROUND_TASK_TIMEOUT_TEST_MS",
    100,
  ),
  SCRIPT_EXECUTION_TIMEOUT_MS: getInt("SCRIPT_EXECUTION_TIMEOUT_MS", 1000),
  CLEANUP_INTERVAL_MS: getInt("CLEANUP_INTERVAL_MS", 10 * 60 * 1000),
  INPUT_POLL_INTERVAL_PROD_MS: getInt("INPUT_POLL_INTERVAL_PROD_MS", 5000),
  INPUT_POLL_INTERVAL_TEST_MS: getInt("INPUT_POLL_INTERVAL_TEST_MS", 100),
  SHUTDOWN_TIMEOUT_MS: getInt("SHUTDOWN_TIMEOUT_MS", 30000),
  SHUTDOWN_RETRY_MAX_ATTEMPTS: getInt("SHUTDOWN_RETRY_MAX_ATTEMPTS", 3),
  SHUTDOWN_RETRY_DELAY_MS: getInt("SHUTDOWN_RETRY_DELAY_MS", 100),
  SSE_HEARTBEAT_INTERVAL_MS: getInt("SSE_HEARTBEAT_INTERVAL_MS", 30000),
  STARTUP_TEST_EXIT_DELAY_MS: getInt("STARTUP_TEST_EXIT_DELAY_MS", 5000),
  DEFAULT_URL_COUNT: getInt(
    "DEFAULT_URL_COUNT",
    inputSchema.properties.urlCount.default,
  ),
  DEFAULT_RETENTION_HOURS: getInt(
    "DEFAULT_RETENTION_HOURS",
    inputSchema.properties.retentionHours.default,
  ),
  DEFAULT_REPLAY_RETRIES: getInt(
    "DEFAULT_REPLAY_RETRIES",
    inputSchema.properties.replayMaxRetries.default,
  ),
  MAX_REPLAY_RETRIES: getInt("MAX_REPLAY_RETRIES", 10),
  DEFAULT_REPLAY_TIMEOUT_MS: getInt(
    "DEFAULT_REPLAY_TIMEOUT_MS",
    inputSchema.properties.replayTimeoutMs.default,
  ),
  DEFAULT_RATE_LIMIT_PER_MINUTE: getInt(
    "DEFAULT_RATE_LIMIT_PER_MINUTE",
    inputSchema.properties.rateLimitPerMinute.default,
  ),
  DEFAULT_RATE_LIMIT_MAX_ENTRIES: getInt(
    "DEFAULT_RATE_LIMIT_MAX_ENTRIES",
    1000,
  ),
  DEFAULT_RATE_LIMIT_WINDOW_MS: getInt("DEFAULT_RATE_LIMIT_WINDOW_MS", 60000),
  HOT_RELOAD_DEBOUNCE_MS: getInt("HOT_RELOAD_DEBOUNCE_MS", 100),
  DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE: getInt(
    "DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE",
    10000,
  ),
  DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES: getInt(
    "DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES",
    10000,
  ),
  DEFAULT_PAYLOAD_LIMIT: getInt(
    "DEFAULT_PAYLOAD_LIMIT",
    inputSchema.properties.maxPayloadSize.default,
  ),
  DEFAULT_FIXED_MEMORY_MBYTES: getInt(
    "DEFAULT_FIXED_MEMORY_MBYTES",
    inputSchema.properties.fixedMemoryMbytes.default,
  ),
  DEFAULT_FORWARD_RETRIES: getInt(
    "DEFAULT_FORWARD_RETRIES",
    inputSchema.properties.maxForwardRetries.default,
  ),
  DEFAULT_MASK_SENSITIVE_DATA: inputSchema.properties.maskSensitiveData.default,
  DEFAULT_ENABLE_JSON_PARSING: inputSchema.properties.enableJSONParsing.default,
  DEFAULT_FORWARD_HEADERS: inputSchema.properties.forwardHeaders.default,

  // Validation Limits & Safe Bounds
  MAX_SAFE_URL_COUNT: getInt(
    "MAX_SAFE_URL_COUNT",
    inputSchema.properties.urlCount.maximum,
  ),
  MAX_SAFE_RETENTION_HOURS: getInt(
    "MAX_SAFE_RETENTION_HOURS",
    inputSchema.properties.retentionHours.maximum,
  ),
  MAX_SAFE_RATE_LIMIT_PER_MINUTE: getInt(
    "MAX_SAFE_RATE_LIMIT_PER_MINUTE",
    inputSchema.properties.rateLimitPerMinute.maximum,
  ),
  MAX_SAFE_REPLAY_RETRIES: getInt(
    "MAX_SAFE_REPLAY_RETRIES",
    inputSchema.properties.replayMaxRetries.maximum,
  ),
  MAX_SAFE_REPLAY_TIMEOUT_MS: getInt(
    "MAX_SAFE_REPLAY_TIMEOUT_MS",
    inputSchema.properties.replayTimeoutMs.maximum,
  ),
  MAX_SAFE_RESPONSE_DELAY_MS: getInt(
    "MAX_SAFE_RESPONSE_DELAY_MS",
    inputSchema.properties.responseDelayMs.maximum,
  ),
  MAX_SAFE_FORWARD_RETRIES: getInt(
    "MAX_SAFE_FORWARD_RETRIES",
    inputSchema.properties.maxForwardRetries.maximum,
  ),
  MAX_SAFE_FIXED_MEMORY_MBYTES: getInt(
    "MAX_SAFE_FIXED_MEMORY_MBYTES",
    inputSchema.properties.fixedMemoryMbytes.maximum,
  ),
  MAX_ALLOWED_PAYLOAD_SIZE: getInt(
    "MAX_ALLOWED_PAYLOAD_SIZE",
    inputSchema.properties.maxPayloadSize.maximum,
  ),
  MIN_REPLAY_TIMEOUT_MS: getInt(
    "MIN_REPLAY_TIMEOUT_MS",
    inputSchema.properties.replayTimeoutMs.minimum,
  ),
  MIN_FIXED_MEMORY_MBYTES: getInt(
    "MIN_FIXED_MEMORY_MBYTES",
    inputSchema.properties.fixedMemoryMbytes.minimum,
  ),
  DEFAULT_PORT: getInt("ACTOR_WEB_SERVER_PORT", 8080),
  MAX_BULK_CREATE: getInt("MAX_BULK_CREATE", 1000),
  RETENTION_LOG_SUPPRESSION_MS: getInt(
    "RETENTION_LOG_SUPPRESSION_MS",
    5 * 60 * 1000,
  ),
  PLATFORM_ERROR_KEYWORDS: ["dataset", "quota", "limit", "rate"],
});

export const REPLAY_STATUS_LABELS = Object.freeze({
  REPLAYED: "replayed",
});

export const SORT_DIRECTIONS = Object.freeze({
  ASC: "ASC",
  DESC: "DESC",
});

export const SYSTEM_CONSTS = Object.freeze({
  SYNC_ENTITY_SYSTEM: "SYSTEM",
});

export const FORWARDING_CONSTS = Object.freeze({
  FORWARD_TIMEOUT_MS: getInt("FORWARD_TIMEOUT_MS", 10000),
  RETRY_BASE_DELAY_MS: getInt("RETRY_BASE_DELAY_MS", 1000),
  TRANSIENT_ERROR_CODES: [
    "ECONNABORTED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EAI_AGAIN",
    "ENOTFOUND",
  ],
  TIMEOUT_CODE: "ECONNABORTED",
  TIMEOUT_CODES: ["ECONNABORTED", "ETIMEDOUT"],
  CONNECTION_POOL_MAX_SOCKETS: getInt("CONNECTION_POOL_MAX_SOCKETS", 50),
  CONNECTION_POOL_MAX_FREE_SOCKETS: getInt(
    "CONNECTION_POOL_MAX_FREE_SOCKETS",
    10,
  ),
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: getInt(
    "CIRCUIT_BREAKER_FAILURE_THRESHOLD",
    5,
  ),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: getInt(
    "CIRCUIT_BREAKER_RESET_TIMEOUT_MS",
    30000,
  ),
  BASE_ERROR_MSG_LENGTH: getInt("BASE_ERROR_MSG_LENGTH", 100),
  CIRCUIT_BREAKER_MAX_SIZE: getInt("CIRCUIT_BREAKER_MAX_SIZE", 10000),
  CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS: getInt(
    "CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS",
    60000,
  ),

  RETRY_BACKOFF_BASE: getInt("RETRY_BACKOFF_BASE", 2),
  HTTP_PREFIX: "HTTP_",
});

export const APP_ROUTES = Object.freeze({
  WEBHOOK: "/webhook/:id",
  LOGS: "/logs",
  LOG_DETAIL: "/logs/:logId",
  LOG_PAYLOAD: "/logs/:logId/payload",
  LOG_STREAM: "/log-stream",
  REPLAY: "/replay/:webhookId/:itemId",
  INFO: "/info",
  HEALTH: "/health",
  READY: "/ready",
  DASHBOARD: "/",
  SYSTEM_METRICS: "/system/metrics",
  FONTS: "/fonts",
});

export const QUERY_PARAMS = Object.freeze({
  STATUS: "__status",
});

export const ENV_VARS = Object.freeze({
  NODE_ENV: "NODE_ENV",
  LOG_LEVEL: "LOG_LEVEL",
  PRETTY_LOGS: "PRETTY_LOGS",
  DISABLE_HOT_RELOAD: "DISABLE_HOT_RELOAD",
  ACTOR_WEB_SERVER_PORT: "ACTOR_WEB_SERVER_PORT",
  DUCKDB_STORAGE_DIR: "DUCKDB_STORAGE_DIR",
  DUCKDB_FILENAME: "DUCKDB_FILENAME",
  INPUT: "INPUT",
  NPM_PACKAGE_VERSION: "npm_package_version",
  APIFY_ACTOR_DIR: "APIFY_ACTOR_DIR",
  APIFY_LOCAL_STORAGE_DIR: "APIFY_LOCAL_STORAGE_DIR",
  DUCKDB_MEMORY_LIMIT: "DUCKDB_MEMORY_LIMIT",
  DUCKDB_VACUUM_ENABLED: "DUCKDB_VACUUM_ENABLED",
});

export const SHUTDOWN_SIGNALS = Object.freeze({
  TEST_COMPLETE: "TEST_COMPLETE",
  MIGRATING: "MIGRATING",
  ABORTING: "ABORTING",
  SIGTERM: "SIGTERM",
  SIGINT: "SIGINT",
  TESTANDEXIT: "TESTANDEXIT",
});

export const ENV_VALUES = Object.freeze({
  TEST: "test",
});

export const STREAM_EVENTS = Object.freeze({
  DATA: "data",
  ERROR: "error",
  CLOSE: "close",
});

export const INTERNAL_EVENTS = Object.freeze({
  LOG_RECEIVED: "log:received",
});
