/**
 * @file src/consts/network.js
 * @description Network, DNS, and SSRF-related constants.
 */
import { getInt } from "../utils/env.js";

/**
 * IP ranges to block for SSRF prevention.
 */
export const SSRF_BLOCKED_RANGES = Object.freeze([
  // IPv4 private/reserved ranges
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",

  // Cloud metadata endpoints
  "169.254.169.254/32",
  "100.100.100.200/32",

  // IPv6 equivalents
  "::1/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
]);

export const ALLOWED_PROTOCOLS = Object.freeze(["http:", "https:"]);

/**
 * Error messages for SSRF validation.
 */
export const SSRF_ERRORS = Object.freeze({
  INVALID_URL: "Invalid URL format",
  PROTOCOL_NOT_ALLOWED: "Only http/https URLs are allowed",
  CREDENTIALS_NOT_ALLOWED: "Credentials in URL are not allowed",
  HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname",
  INVALID_IP: "URL resolves to invalid IP address",
  INTERNAL_IP: "URL resolves to internal/reserved IP range",
  VALIDATION_FAILED: "URL validation failed",
});

/**
 * Internal technical error constants for SSRF validation.
 */
export const SSRF_INTERNAL_ERRORS = Object.freeze({
  DNS_TIMEOUT: "DNS_TIMEOUT",
});

/**
 * Log messages for SSRF validation failures.
 */
export const SSRF_LOG_MESSAGES = Object.freeze({
  DNS_TIMEOUT: "DNS resolution timed out",
  RESOLUTION_FAILED: "DNS resolution failed",
});

export const ERROR_MESSAGES = Object.freeze({
  HOSTNAME_RESOLUTION_FAILED: "Hostname Resolution Failed",
});

export const DNS_RESOLUTION_TIMEOUT_MS = getInt(
  "DNS_RESOLUTION_TIMEOUT_MS",
  5000,
);

export const RETRY_BASE_DELAY_MS = getInt("RETRY_BASE_DELAY_MS", 1000);

export const TRANSIENT_ERROR_CODES = Object.freeze([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

export const DELIMITERS = Object.freeze({
  QUERY_SORT: ":",
  QUERY_LIST: ",",
});

export const PROTOCOL_PREFIXES = Object.freeze({
  HTTP: "http://",
  HTTPS: "https://",
});
