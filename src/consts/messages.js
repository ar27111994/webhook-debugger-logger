/**
 * @file src/consts/messages.js
 * @description Standard business logic log messages.
 * @module consts/messages
 */

export const LOG_MESSAGES = Object.freeze({
  KVS_OFFLOAD_START: "Streaming large payload to KVS",
  KVS_OFFLOAD_ERROR: "Failed to process large upload",
  WEBHOOK_CLEANUP: "Webhook cleanup triggered",
  WEBHOOK_RETENTION_UPDATE: "Updating retention policy",
  CONFIG_UPDATE: "Configuration update applied",
  SYNC_START: "SyncService starting (Event-Driven)",
  SYNC_STOP: "SyncService stopped",
  VACUUM_COMPLETE: "Vacuum and checkpoint completed",
  STARTUP_COMPLETE: "Enterprise Webhook Suite initialized.",
  SERVER_STARTED:
    /**
     * @param {number} port
     * @returns {string}
     */
    (port) => `Web server listening on port ${port}`,
  SHUTDOWN_INITIATED:
    /**
     * @param {string} signal
     * @returns {string}
     */
    (signal) => `Shutting down server (${signal})...`,
  SHUTDOWN_RETRY: "Shutdown failed, retrying...",
  SHUTDOWN_FAILED_AFTER_RETRIES: "Shutdown failed after maximum retries",
  SHUTDOWN_COMPLETE: "Shutdown complete.",
  UNAUTHORIZED_ACCESS: "Unauthorized access",
  SERVER_ERROR: "Server error",
  UNKNOWN_ERROR: "Unknown error",
  HYDRATING_PAYLOAD: "Hydrating offloaded payload from KVS",
  HYDRATE_FAILED_KEY: "Failed to find KVS key, sending metadata instead",
  HYDRATE_ERROR: "Error fetching KVS key",
  REPLAY_RETRY: "Replay attempt failed, retrying",
  STRIPPED_HEADERS_WARNING: "Headers stripped (masked or transmission-related)",
  FAILED_SSE_ESTABLISH: "Failed to establish SSE stream",
  BROADCAST_FAILED: "Failed to broadcast message to client",
  REALTIME_INSERT_FAILED: "Real-time insert failed",
  SYNC_SCHEDULE_ERROR: "Sync scheduling error",
  SYNC_DATASET_START: "Syncing items from Dataset",
  SYNC_ERROR_GENERAL: "Sync error",
  SSRF_BLOCKED: "SSRF blocked forward URL",
  FAILED_LOG_FORWARD: "Failed to log forward error",
  SLACK_NOTIF_FAILED: "Slack notification failed",
  DISCORD_NOTIF_FAILED: "Discord notification failed",
  UPDATE_MAX_PAYLOAD: "Updating max payload size",
  UPDATE_RATE_LIMIT: "Updating rate limit",
  AUTH_KEY_UPDATED: "Auth key updated",
  DYNAMIC_SCALE_UP: "Dynamic scale-up: generating additional webhook(s)",
  UPDATE_RETENTION: "Updating retention policy",
  UPDATE_REPLAY_RETRIES: "Updating replay max retries",
  UPDATE_REPLAY_TIMEOUT: "Updating replay timeout",
  UPDATE_FIXED_MEMORY: "Updating fixed memory toggle",
  UPDATE_MANUAL_MEMORY: "Updating manual memory target",
  API_KEY_QUERY_WARNING:
    "API key provided in query string, use Authorization header instead",
  INPUT_INVALID_REWRITTEN: "INPUT.json was invalid, rewritten with defaults",
  INPUT_READ_FAILED: "Failed to read INPUT.json",
  LOCAL_CONFIG_INIT: "Local configuration initialized",
  LOCAL_CONFIG_TIP: "Tip: Edit this file to hot-reload settings while running",
  DEFAULT_INPUT_WRITE_FAILED: "Failed to write default input file",
  INPUT_ACCESS_ERROR: "Unexpected error accessing INPUT.json",
  SCHEMA_LOAD_FAILED:
    "Failed to load input_schema.json, using minimal defaults",
  CONFIG_VALUE_CLAMPED: "Value exceeds safe max, clamping to limit",
  HOT_RELOAD_NOT_INIT: "HotReloadManager not initialized, skipping start",
  HOT_RELOAD_POLL_FAILED: "Polling hot-reload failed",
  HOT_RELOAD_POLL_ENABLED: "Hot-reload polling enabled",
  HOT_RELOAD_POLL_DISABLED:
    "Hot-reload polling disabled via DISABLE_HOT_RELOAD",
  HOT_RELOAD_DETECTED: "Detected input update, applying new settings",
  HOT_RELOAD_COMPLETE: "Hot-reload complete, new settings active",
  HOT_RELOAD_LOCAL_MODE:
    "Local mode detected, using fs.watch for instant hot-reload",
  HOT_RELOAD_WATCHER_WARNING:
    "Input file renamed/replaced, potential watcher break",
  HOT_RELOAD_WATCH_FAILED: "fs.watch hot-reload failed",
  HOT_RELOAD_WATCH_ERROR: "fs.watch failed",
  RATELIMIT_PRUNED: "RateLimiter pruned expired entries",
  RATELIMIT_REJECT_NO_IP: "Rejecting request with unidentifiable IP",
  RATELIMIT_EVICTED: "RateLimiter evicted entry",
  WEBHOOK_RATELIMIT_PRUNED: "WebhookRateLimiter pruned expired entries",
  SSE_CONNECTION_LIMIT_REACHED:
    /**
     * @param {number} limit
     * @returns {string}
     */
    (limit) => `Maximum SSE connections reached (${limit}). Try again later.`,
  SERVER_START_FAILED: "Server failed to start",
  CLEANUP_ERROR: "Cleanup error",
  FORCE_SHUTDOWN: "Forceful shutdown after timeout",
  SHUTDOWN_START: "Shutting down",
  INPUT_ENV_VAR_PARSED: "Using override from INPUT environment variable",
  INPUT_ENV_VAR_INVALID: "INPUT env var must be a non-array JSON object",
  INPUT_ENV_VAR_PARSE_FAILED: "Failed to parse INPUT env var",
  SCALING_INITIALIZING: "Initializing webhooks",
  SCALING_UP: "Scaling up: generating additional webhooks",
  SCALING_LIMIT_REACHED: "Active webhooks exceed requested count",
  SCALING_RESUMING: "Resuming with active webhooks",
  SCRIPT_COMPILED: "Custom script re-compiled successfully.",
  SCHEMA_COMPILED: "JSON Schema re-compiled successfully.",
  STREAM_VERIFIER_INIT: "Stream signature verification initialized",
  STREAM_VERIFIER_FAILED: "Failed to init stream verifier",
  STREAM_OFFLOAD_FAILED: "Streaming offload failed",
  BACKGROUND_TASKS_FAILED: "Background tasks failed",
  BACKGROUND_TIMEOUT: "Background tasks exceeded timeout",
  MIDDLEWARE_ERROR_SENT: "Internal middleware error after headers sent",
  DASHBOARD_LOAD_FAILED: "Failed to load index.html",
  DASHBOARD_PRELOAD_FAILED: "Failed to preload index.html",
  INIT_DB_SYNC_FAILED: "Failed to initialize DuckDB or SyncService",
  STARTUP_LOG_FAILED: "Startup log failed",
  TRANSACTION_ROLLBACK_FAILED: "Failed to rollback transaction",
  RESOURCE_INVALID: "Invalid resource",
  WEBHOOK_STATE_RESTORED: "Restored webhooks from state",
  WEBHOOK_STATE_INIT_FAILED: "Failed to initialize WebhookManager state",
  WEBHOOK_STATE_PERSIST_FAILED: "Failed to persist webhook state",
  CLEANUP_DELETED_PAYLOADS: "Deleted offloaded payloads",
  CLEANUP_WEBHOOK_REMOVED: "Removed expired webhook and data",
  CLEANUP_WEBHOOK_FAILED: "Failed to clean up webhook",
  RETENTION_REFRESHED: "Refreshed webhook retention",
  KVS_DELETE_FAILED: "Failed to delete KVS key during cleanup",
  VACUUM_FAILED: "DuckDB vacuum failed",
  MASK_HIDDEN: "unknown",
  MASK_IPV6_SUFFIX: ":****",
  MASK_IPV4_SUFFIX: ".****",

  JSON_SCHEMA_VALIDATION_FAILED: "JSON Schema Validation Failed",
  KVS_OFFLOAD_THRESHOLD_EXCEEDED: "Body exceeds threshold, offloading to KVS",
  KVS_OFFLOAD_FAILED_LARGE_PAYLOAD: "Failed to offload large payload to KVS",
  TRUNCATED_AND_KVS_FAILED: "\n...[TRUNCATED_AND_KVS_FAILED]",
  PAYLOAD_TOO_LARGE_KVS_FAILED: "Payload too large and KVS offload failed.",
  SCRIPT_EXECUTION_TIMEOUT_ERROR: "Script execution timed out",
  SCRIPT_EXECUTION_TIMED_OUT:
    /**
     * @param {number} ms
     * @returns {string}
     */
    (ms) => `Custom script execution timed out after ${ms}ms`,
  SCRIPT_EXECUTION_FAILED: "Failed to run custom script",
  WEBHOOK_RECEIVED_STATUS:
    /**
     * @param {number} statusCode
     * @returns {string}
     */
    (statusCode) => `Webhook received with status ${statusCode}`,
  PLATFORM_LIMIT_ERROR: "Platform limit error",
  BACKGROUND_ERROR: "Background error",
  CHECK_PLATFORM_LIMITS: "Check Apify platform limits or storage availability",
  CIRCUIT_BREAKER_OPEN: "Circuit breaker open, skipping forward request",
  FORWARD_PAYLOAD_TOO_LARGE: "Forwarding payload too large, skipping",
  FORWARD_ABORTED: "Forwarding aborted by signal",
  BINARY_OBJECT_PLACEHOLDER: "[Binary Object]",
});
