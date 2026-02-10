/**
 * @file src/consts/network.js
 * @description Network, DNS, and SSRF-related constants.
 * @module consts/network
 */
import { getInt } from "../utils/env.js";

/**
 * IP ranges to block for SSRF prevention.
 */
/** @type {readonly string[]} */
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
 * Internal technical error constants for SSRF validation.
 * @enum {string}
 */
export const SSRF_INTERNAL_ERRORS = Object.freeze({
  DNS_TIMEOUT: "DNS_TIMEOUT",
});

/**
 * Log messages for SSRF validation failures.
 * @enum {string}
 */
export const SSRF_LOG_MESSAGES = Object.freeze({
  DNS_TIMEOUT: "DNS resolution timed out",
  RESOLUTION_FAILED: "DNS resolution failed",
  VALIDATION_ERROR: "SSRF validation error",
});

export const DNS_RESOLUTION_TIMEOUT_MS = getInt(
  "DNS_RESOLUTION_TIMEOUT_MS",
  5000,
);

export const DELIMITERS = Object.freeze({
  QUERY_SORT: ":",
  QUERY_LIST: ",",
});

export const PROTOCOL_PREFIXES = Object.freeze({
  HTTP: "http://",
  HTTPS: "https://",
});
