/**
 * @file src/consts/errors.js
 * @description Centralized error labels and common error messages.
 * @module consts/errors
 */

import { APP_CONSTS } from "./app.js";

/**
 * @enum {string}
 */
export const ERROR_LABELS = Object.freeze({
  INTERNAL_SERVER_ERROR: "Internal Server Error",
  PAYLOAD_TOO_LARGE: "Payload Too Large",
  BAD_REQUEST: "Bad Request",
  UNAUTHORIZED: "Unauthorized",
  NOT_FOUND: "Not Found",
  FORBIDDEN: "Forbidden",
  SERVICE_UNAVAILABLE: "Service Unavailable",
  GATEWAY_TIMEOUT: "Gateway Timeout",
  UNPROCESSABLE_ENTITY: "Unprocessable Entity",
  REPLAY_FAILED: "Replay Failed",
  LOGS_FAILED: "Logs Failed",
  FORWARD_ERROR: "Forward Error",
  CLIENT_ERROR: "Client Error",
  INVALID_SIGNATURE: "Invalid signature",
  SIGNATURE_MISMATCH_STREAM: "Signature mismatch (stream verified)",
  INVALID_JSON_SCHEMA: "Invalid JSON schema",
  GENERIC: "Error",
});

export const ERROR_MESSAGES = Object.freeze({
  LOG_NOT_FOUND: "Log entry not found",
  LOG_FETCH_FAILED: "Failed to fetch log detail",
  EVENT_NOT_FOUND: "Event not found",
  INVALID_LOG_ACCESS: "Log entry belongs to invalid webhook",
  PAYLOAD_NOT_FOUND_KVS: "Payload not found in KVS",
  MISSING_URL: "Missing 'url' parameter",
  DB_NOT_INITIALIZED: "Database not initialized",
  UNAUTHORIZED_KEY: "Unauthorized: Missing API key",
  SCRIPT_TIMEOUT: "Script execution timed out",
  FORWARD_FAILED: "Forward attempt failed",
  FORWARD_TIMEOUT: "Forward attempt timed out",
  HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname",
  PAYLOAD_FETCH_FAILED: "Failed to fetch log payload",
  WEBHOOK_CREATION_FAILED: "Failed to create webhook",
  WEBHOOK_UPDATE_FAILED: "Failed to update webhook",
  INVALID_WEBHOOK_LOG: "Log entry belongs to invalid webhook",
  LOG_DETAIL_FAILED: "Failed to fetch log detail",
  FORWARD_REQUEST_FAILED: "Request Failed",
  ABORTED: "Aborted",
  SCHEMA_COMPILATION_FAILED: "Schema compilation failed",
  FORWARD_REQUEST_FAILED_STATUS:
    /**
     * @param {number} status
     * @returns {string}
     */
    (status) => `Request failed with status code ${status}`,

  // Rate Limiter
  RATE_LIMIT_NO_IP:
    "Client IP could not be identified. Ensure your request includes standard IP headers if behind a proxy.",
  RATE_LIMIT_EXCEEDED:
    /**
     * @param {number} limit
     * @param {number} windowSeconds
     * @returns {string}
     */
    (limit, windowSeconds) =>
      `Rate limit exceeded. Max ${limit} requests per ${windowSeconds}s.`,

  // Middleware
  INVALID_JSON: "Invalid JSON for schema validation",
  RECURSIVE_FORWARDING:
    "Recursive forwarding detected. The forwarding target appears to be the Actor itself.",
  RECURSIVE_FORWARDING_BLOCKED:
    "Recursive forwarding loop detected and blocked (Self-Reference).",
  PAYLOAD_TOO_LARGE:
    /**
     * @param {number} limit
     * @returns {string}
     */
    (limit) => `Payload too large. Limit is ${limit} bytes.`,
  PAYLOAD_STREAM_FAILED: "Failed to process large upload",
  WEBHOOK_NOT_FOUND: "Webhook ID not found or expired",
  FORBIDDEN_IP: "Forbidden: IP not in whitelist",
  REPLAY_TIMEOUT:
    /**
     * @param {number} attempts
     * @param {number} timeoutMs
     * @returns {string}
     */
    (attempts, timeoutMs) =>
      `Target destination timed out after ${attempts} attempts (${timeoutMs / APP_CONSTS.MS_PER_SECOND
      }s timeout per attempt)`,
  REPLAY_ATTEMPTS_EXHAUSTED:
    /**
     * @param {number} attempts
     * @returns {string}
     */
    (attempts) => `All ${attempts} retry attempts exhausted`,
  INVALID_COUNT:
    /**
     * @param {number} count
     * @returns {string}
     */
    (count) => `Invalid count: ${count}. Must be a non-negative integer.`,
  INVALID_COUNT_MAX:
    /**
     * @param {number} count
     * @param {number} max
     * @returns {string}
     */
    (count, max) => `Invalid count: ${count}. Max allowed is ${max}.`,
  INVALID_RETENTION:
    /**
     * @param {number} hours
     * @returns {string}
     */
    (hours) => `Invalid retentionHours: ${hours}. Must be a positive number.`,
  SSE_LIMIT_REACHED:
    /**
     * @param {number} limit
     * @returns {string}
     */
    (limit) => `Maximum SSE connections reached (${limit}). Try again later.`,
  FORWARD_FAILURE_DETAILS:
    /**
     * @param {string} url
     * @param {boolean} isTransient
     * @param {number} attempts
     * @param {string} error
     * @returns {string}
     */
    (url, isTransient, attempts, error) =>
      `Forwarding to ${url} failed${!isTransient ? " (Non-transient error)" : ""
      } after ${attempts} attempts. Last error: ${error}`,
  BOTTLENECK_STOPPED: "has been stopped",
  RATE_LIMITER_INVALID_WINDOW:
    "RateLimiter: windowMs must be a finite number > 0",
  RATE_LIMITER_INVALID_MAX_ENTRIES:
    "RateLimiter: maxEntries must be a finite integer > 0",
  RATE_LIMITER_INVALID_LIMIT:
    "RateLimiter: limit must be a finite integer >= 0",
  WEBHOOK_RATE_LIMIT_EXCEEDED:
    /**
     * @param {number} limit
     * @returns {string}
     */
    (limit) =>
      `Webhook rate limit exceeded. Max ${limit} requests per minute per webhook.`,
  ACTOR_PUSH_DATA_TIMEOUT:
    /**
     * @param {number} ms
     * @returns {string}
     */
    (ms) => `Actor.pushData timeout after ${ms}ms`,
  ALERT_URL_BLOCKED_BY_SSRF_POLICY:
    /**
     * @param {string} error
     * @returns {string}
     */
    (error) => `Alert URL blocked by SSRF policy: ${error}`,
  JSON_PARSE_ERROR:
    /**
     * @param {string} err
     * @returns {string}
     */
    (err) => `JSON parse error: ${err}`,
  SYNC_VERSION_FAILED:
    /**
     * @param {string} error
     * @returns {string}
     */
    (error) => `Failed to sync version: ${error}`,
});

/**
 * @enum {string}
 */
export const SIGNATURE_ERRORS = Object.freeze({
  NO_SECRET: "No signing secret configured",
  MISSING_HEADER: "Missing signature header",
  INVALID_FORMAT: "Invalid signature format",
  TIMESTAMP_TOLERANCE: "Timestamp outside tolerance",
  MISMATCH: "Signature mismatch",
  UNKNOWN_PROVIDER: "Unknown provider",
  MISSING_TIMESTAMP: "Missing timestamp header",
  CUSTOM_HEADER_REQUIRED: "Custom provider requires headerName",
  MISSING_CUSTOM_HEADER:
    /**
     * @param {string} headerName
     * @returns {string}
     */
    (headerName) => `Missing ${headerName} header`,
});

/**
 * @enum {string}
 */
export const NODE_ERROR_CODES = Object.freeze({
  ERR_SCRIPT_EXECUTION_TIMEOUT: "ERR_SCRIPT_EXECUTION_TIMEOUT",
  ENOENT: "ENOENT",
  EEXIST: "EEXIST",
  ERR_BAD_REQUEST: "ERR_BAD_REQUEST",
  ERR_BAD_RESPONSE: "ERR_BAD_RESPONSE",
  ABORT_ERROR: "AbortError",
});
