import { getInt } from "./utils/common.js";

export const SSE_HEARTBEAT_INTERVAL_MS = getInt(
  "SSE_HEARTBEAT_INTERVAL_MS",
  30000,
);
export const SHUTDOWN_TIMEOUT_MS = getInt("SHUTDOWN_TIMEOUT_MS", 30000);
export const STARTUP_TEST_EXIT_DELAY_MS = getInt(
  "STARTUP_TEST_EXIT_DELAY_MS",
  5000,
);
export const CLEANUP_INTERVAL_MS = getInt(
  "CLEANUP_INTERVAL_MS",
  10 * 60 * 1000,
);

export const INPUT_POLL_INTERVAL_PROD_MS = getInt(
  "INPUT_POLL_INTERVAL_PROD_MS",
  5000,
);
  "INPUT_POLL_INTERVAL_TEST_MS",
  100,
);
export const HOT_RELOAD_DEBOUNCE_MS = getInt("HOT_RELOAD_DEBOUNCE_MS", 100);

export const DEFAULT_REPLAY_RETRIES = getInt("DEFAULT_REPLAY_RETRIES", 3);
export const DEFAULT_REPLAY_TIMEOUT_MS = getInt(
  "DEFAULT_REPLAY_TIMEOUT_MS",
  10000,
);
export const REPLAY_SCAN_MAX_DEPTH_MS = getInt(
  "REPLAY_SCAN_MAX_DEPTH_MS",
  24 * 60 * 60 * 1000,
); // 24 hours

export const FORWARD_TIMEOUT_MS = getInt("FORWARD_TIMEOUT_MS", 10000);
export const BACKGROUND_TASK_TIMEOUT_PROD_MS = getInt(
  "BACKGROUND_TASK_TIMEOUT_PROD_MS",
  10000,
);
export const BACKGROUND_TASK_TIMEOUT_TEST_MS = getInt(
  "BACKGROUND_TASK_TIMEOUT_TEST_MS",
  100,
);
export const DEFAULT_FORWARD_RETRIES = getInt("DEFAULT_FORWARD_RETRIES", 3);
export const SCRIPT_EXECUTION_TIMEOUT_MS = getInt(
  "SCRIPT_EXECUTION_TIMEOUT_MS",
  1000,
);
export const DNS_RESOLUTION_TIMEOUT_MS = getInt(
  "DNS_RESOLUTION_TIMEOUT_MS",
  5000,
);

export const MAX_BULK_CREATE = getInt("MAX_BULK_CREATE", 1000);
export const MAX_ITEMS_FOR_BATCH = getInt("MAX_ITEMS_FOR_BATCH", 1000);
export const DEFAULT_URL_COUNT = getInt("DEFAULT_URL_COUNT", 3);
export const DEFAULT_RETENTION_HOURS = getInt("DEFAULT_RETENTION_HOURS", 24);
export const DEFAULT_RATE_LIMIT_PER_MINUTE = getInt(
  "DEFAULT_RATE_LIMIT_PER_MINUTE",
  60,
);
export const DEFAULT_RATE_LIMIT_WINDOW_MS = getInt(
  "DEFAULT_RATE_LIMIT_WINDOW_MS",
  60 * 1000,
); // 1 minute in ms
export const DEFAULT_PAYLOAD_LIMIT = getInt(
  "DEFAULT_PAYLOAD_LIMIT",
  10 * 1024 * 1024,
); // 10MB
export const DEFAULT_TOLERANCE_SECONDS = getInt(
  "DEFAULT_TOLERANCE_SECONDS",
  300,
); // 5 minutes

// Safe Maximums for Self-Hosting/Validation
export const MAX_SAFE_REPLAY_RETRIES = getInt("MAX_SAFE_REPLAY_RETRIES", 10);
export const MAX_SAFE_RATE_LIMIT_PER_MINUTE = getInt(
  "MAX_SAFE_RATE_LIMIT_PER_MINUTE",
  1000,
);
export const MAX_SAFE_RETENTION_HOURS = getInt("MAX_SAFE_RETENTION_HOURS", 168); // 7 days
export const MAX_SAFE_URL_COUNT = getInt("MAX_SAFE_URL_COUNT", 50);
export const MAX_SAFE_REPLAY_TIMEOUT_MS = getInt(
  "MAX_SAFE_REPLAY_TIMEOUT_MS",
  60000,
); // 60 seconds
export const MAX_SAFE_RESPONSE_DELAY_MS = getInt(
  "MAX_SAFE_RESPONSE_DELAY_MS",
  10000,
); // 10 seconds
export const MAX_ALLOWED_PAYLOAD_SIZE = getInt(
  "MAX_ALLOWED_PAYLOAD_SIZE",
  100 * 1024 * 1024,
); // 100MB
export const MAX_SAFE_FORWARD_RETRIES = getInt("MAX_SAFE_FORWARD_RETRIES", 10);

// DuckDB Configuration
export const DUCKDB_STORAGE_DIR =
  process.env.DUCKDB_STORAGE_DIR ||
  process.env.APIFY_LOCAL_STORAGE_DIR ||
  "./storage";
export const DUCKDB_FILENAME = process.env.DUCKDB_FILENAME || "logs.duckdb";
export const DUCKDB_MEMORY_LIMIT = process.env.DUCKDB_MEMORY_LIMIT || "512MB";
export const DUCKDB_THREADS = getInt("DUCKDB_THREADS", 4);

export const REPLAY_HEADERS_TO_IGNORE = Object.freeze([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

export const SENSITIVE_HEADERS = Object.freeze([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

export const FORWARD_HEADERS_TO_IGNORE = Object.freeze([
  ...SENSITIVE_HEADERS,
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
  "upgrade",
]);

export const ERROR_MESSAGES = Object.freeze({
  HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname for 'url'",
  DNS_FAILURE: "Unable to validate 'url' parameter (DNS failure)", // Deprecated: use HOSTNAME_RESOLUTION_FAILED instead
});

export const SSRF_INTERNAL_ERRORS = Object.freeze({
  DNS_TIMEOUT: "DNS_TIMEOUT",
});

export const SSRF_LOG_MESSAGES = Object.freeze({
  DNS_TIMEOUT: "DNS resolution timed out",
  RESOLUTION_FAILED: "Resolution failed",
});

export const TRANSIENT_ERROR_CODES = Object.freeze([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

export const SYNC_MAX_CONCURRENT = getInt("SYNC_MAX_CONCURRENT", 1);
export const SYNC_MIN_TIME_MS = getInt("SYNC_MIN_TIME_MS", 500);
export const SYNC_BATCH_SIZE = getInt("SYNC_BATCH_SIZE", 1000);

export const DEFAULT_PAGE_LIMIT = getInt("DEFAULT_PAGE_LIMIT", 20);
export const MAX_PAGE_LIMIT = getInt("MAX_PAGE_LIMIT", 10000);
export const DEFAULT_PAGE_OFFSET = getInt("DEFAULT_PAGE_OFFSET", 0);

export const EVENT_MAX_LISTENERS = getInt("EVENT_MAX_LISTENERS", 20);
