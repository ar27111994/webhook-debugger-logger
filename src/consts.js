export const SSE_HEARTBEAT_INTERVAL_MS = 30000;
export const SHUTDOWN_TIMEOUT_MS = 30000;
export const STARTUP_TEST_EXIT_DELAY_MS = 5000;
export const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

export const INPUT_POLL_INTERVAL_PROD_MS = 5000;
export const INPUT_POLL_INTERVAL_TEST_MS = 100;

export const MAX_REPLAY_RETRIES = 3;
export const REPLAY_TIMEOUT_MS = 10000;

export const FORWARD_TIMEOUT_MS = 10000;
export const BACKGROUND_TASK_TIMEOUT_PROD_MS = 10000;
export const BACKGROUND_TASK_TIMEOUT_TEST_MS = 100;
export const MAX_FORWARD_RETRIES = 3;
export const SCRIPT_EXECUTION_TIMEOUT_MS = 1000;

export const MAX_BULK_CREATE = 1000;
export const DEFAULT_URL_COUNT = 3;
export const DEFAULT_RETENTION_HOURS = 24;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute in ms
export const DEFAULT_PAYLOAD_LIMIT = 10 * 1024 * 1024; // 10MB
export const MAX_ALLOWED_PAYLOAD_SIZE = 100 * 1024 * 1024; // 100MB

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
