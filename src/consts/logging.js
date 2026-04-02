/**
 * @file src/consts/logging.js
 * @description Logging component names and redaction configurations.
 * @module consts/logging
 */

import { SENSITIVE_HEADERS } from "./http.js";

/**
 * @enum {string}
 */
export const LOG_COMPONENTS = Object.freeze({
  LOGGER_MIDDLEWARE: "LoggerMiddleware",
  MAIN: "Main",
  WEBHOOK_MANAGER: "WebhookManager",
  ERROR_HANDLER: "ErrorHandler",
  REPLAY: "Replay",
  STREAM: "Stream",
  DASHBOARD: "Dashboard",
  ROUTE_UTILS: "RouteUtils",
  FORWARDING_SERVICE: "ForwardingService",
  ALERTING: "Alerting",
  SYNC_SERVICE: "SyncService",
  APP_STATE: "AppState",
  AUTH: "Auth",
  BOOTSTRAP: "Bootstrap",
  HOT_RELOAD_MANAGER: "HotReloadManager",
  SSRF: "SSRF",
  DUCKDB: "DuckDB",
  WEBHOOK_RATE_LIMITER: "WebhookRateLimiter",
  CONFIG: "Config",
  RATE_LIMITER: "RateLimiter",
  SYNC_VERSION: "SyncVersion",
});

export const LOG_CONSTS = Object.freeze({
  MASKED_VALUE: "[MASKED]",
  CENSOR_MARKER: "[REDACTED]",
  VALID_SORT_FIELDS: [
    "id",
    "statusCode",
    "method",
    "size",
    "timestamp",
    "remoteIp",
    "processingTime",
    "webhookId",
    "userAgent",
    "requestUrl",
    "contentType",
    "requestId",
    "signatureValid",
    "signatureProvider",
    "signatureError",
  ],
  REDACT_PATHS: [
    ...SENSITIVE_HEADERS.map((h) =>
      h.includes("-") ? `req.headers['${h}']` : `req.headers.${h}`,
    ),
    "body.password",
    "body.token",
    "body.secret",
    "body.apiKey",
    "body.api_key",
  ],
  IPV6_MASK_SEGMENTS: 2,
  IPV4_MASK_OCTETS: 3,
});

/**
 * @enum {string}
 */
export const LOG_TAGS = Object.freeze({
  SCRIPT_ERROR: "SCRIPT-ERROR",
  SCHEMA_ERROR: "SCHEMA-ERROR",
  RECURSIVE_LOOP: "RECURSIVE_LOOP",
  STORAGE_OFFLOAD: "STORAGE_OFFLOAD",
  STARTUP: "startup",
});
