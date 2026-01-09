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
export const MAX_PAYLOAD_SIZE_DEFAULT = 10485760; // 10MB
export const MAX_PAYLOAD_SIZE_LIMIT = 1048576; // 1MB middleware limit default

export const REPLAY_HEADERS_TO_IGNORE = [
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
];

export const SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
];

export const FORWARD_HEADERS_TO_IGNORE = [
  ...SENSITIVE_HEADERS,
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
  "upgrade",
];
