/**
 * @file src/consts/app.js
 * @description Application defaults, ID configurations, and lifecycle timeouts.
 */
import { Actor } from "apify";
import { getInt } from "../utils/env.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { homepageUrl } = require("../../.actor/actor.json");

const env = Actor.getEnv();
export const RECURSION_HEADER_VALUE =
  env.actorRunId || `local-${process.env.APIFY_LOCAL_STORAGE_DIR || "dev"}`;

export const DEFAULT_ID_LENGTH = 10;
export const WEBHOOK_ID_PREFIX = "wh_";
export const REQUEST_ID_PREFIX = "req_";
export const SYNC_ENTITY_SYSTEM = "SYSTEM";

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

export const EVENT_NAMES = Object.freeze({
  LOG_RECEIVED: "log:received",
  MIGRATING: "migrating",
  ABORTING: "aborting",
});

export const ERROR_LABELS = Object.freeze({
  INTERNAL_SERVER_ERROR: "Internal Server Error",
  PAYLOAD_TOO_LARGE: "Payload Too Large",
  BAD_REQUEST: "Bad Request",
  NOT_FOUND: "Not Found",
  CLIENT_ERROR: "Client Error",
  REPLAY_FAILED: "Replay failed",
  FORWARD_ERROR: "forward_error",
});

export const REPLAY_STATUS_LABELS = Object.freeze({
  REPLAYED: "Replayed",
  FAILED: "Failed",
});

export const RETENTION_LOG_SUPPRESSION_MS = 5 * 60 * 1000; // 5 minutes

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
export const INPUT_POLL_INTERVAL_TEST_MS = getInt(
  "INPUT_POLL_INTERVAL_TEST_MS",
  100,
);
export const HOT_RELOAD_DEBOUNCE_MS = getInt("HOT_RELOAD_DEBOUNCE_MS", 100);

export const DEFAULT_URL_COUNT = getInt("DEFAULT_URL_COUNT", 3);
export const DEFAULT_RETENTION_HOURS = getInt("DEFAULT_RETENTION_HOURS", 24);
export const DEFAULT_RATE_LIMIT_PER_MINUTE = getInt(
  "DEFAULT_RATE_LIMIT_PER_MINUTE",
  60,
);
export const DEFAULT_FIXED_MEMORY_MBYTES = getInt(
  "DEFAULT_FIXED_MEMORY_MBYTES",
  2048,
);
export const DEFAULT_RATE_LIMIT_MAX_ENTRIES = getInt(
  "DEFAULT_RATE_LIMIT_MAX_ENTRIES",
  1000,
);
export const DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE = getInt(
  "DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE",
  10000,
);
export const DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES = getInt(
  "DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES",
  10000,
);
export const DEFAULT_RATE_LIMIT_WINDOW_MS = getInt(
  "DEFAULT_RATE_LIMIT_WINDOW_MS",
  60 * 1000,
);
export const DEFAULT_PAYLOAD_LIMIT = getInt(
  "DEFAULT_PAYLOAD_LIMIT",
  10 * 1024 * 1024,
);
export const DEFAULT_TOLERANCE_SECONDS = getInt(
  "DEFAULT_TOLERANCE_SECONDS",
  300,
);

// Safe Maximums
export const MAX_SAFE_REPLAY_RETRIES = getInt("MAX_SAFE_REPLAY_RETRIES", 10);
export const MAX_SAFE_RATE_LIMIT_PER_MINUTE = getInt(
  "MAX_SAFE_RATE_LIMIT_PER_MINUTE",
  1000,
);
export const MAX_SAFE_RETENTION_HOURS = getInt("MAX_SAFE_RETENTION_HOURS", 168);
export const MAX_SAFE_URL_COUNT = getInt("MAX_SAFE_URL_COUNT", 50);
export const MAX_SAFE_REPLAY_TIMEOUT_MS = getInt(
  "MAX_SAFE_REPLAY_TIMEOUT_MS",
  60000,
);
export const MAX_SAFE_RESPONSE_DELAY_MS = getInt(
  "MAX_SAFE_RESPONSE_DELAY_MS",
  10000,
);
export const MAX_ALLOWED_PAYLOAD_SIZE = getInt(
  "MAX_ALLOWED_PAYLOAD_SIZE",
  100 * 1024 * 1024,
);
export const MAX_SAFE_FORWARD_RETRIES = getInt("MAX_SAFE_FORWARD_RETRIES", 10);
export const MAX_SAFE_FIXED_MEMORY_MBYTES = getInt(
  "MAX_SAFE_FIXED_MEMORY_MBYTES",
  32768,
);

export const MAX_SSE_CLIENTS = getInt("MAX_SSE_CLIENTS", 100);
export const MAX_BULK_CREATE = getInt("MAX_BULK_CREATE", 1000);
export const MAX_ITEMS_FOR_BATCH = getInt("MAX_ITEMS_FOR_BATCH", 1000);

export const APIFY_HOMEPAGE_URL = homepageUrl;
export const EVENT_MAX_LISTENERS = getInt("EVENT_MAX_LISTENERS", 20);
