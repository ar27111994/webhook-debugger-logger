/**
 * @file src/consts/security.js
 * @description Security related constants including SSRF errors and CSP policies.
 * @module consts/security
 */

import { createRequire } from "module";
import { getInt } from "../utils/env.js";

const require = createRequire(import.meta.url);
const inputSchema = require("../../.actor/input_schema.json");

export const SSRF_ERRORS = Object.freeze({
  INVALID_URL: "Invalid URL format",
  PROTOCOL_NOT_ALLOWED: "Only http/https URLs are allowed",
  CREDENTIALS_NOT_ALLOWED: "Credentials in URL are not allowed",
  HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname",
  INVALID_IP: "URL resolves to invalid IP address",
  INTERNAL_IP: "URL resolves to internal/reserved IP range",
  VALIDATION_FAILED: "URL validation failed",
});

const providers =
  inputSchema.properties.signatureVerification.properties.provider.enum;
const algorithms =
  inputSchema.properties.signatureVerification.properties.algorithm.enum;
const encodings =
  inputSchema.properties.signatureVerification.properties.encoding.enum;

/**
 * Helper function to convert an array to an enum object.
 * @param {string[]} arr
 * @returns {Object<string, string>}
 */
const convertToEnum = (arr) =>
  arr.reduce(
    /**
     * Helper function to convert an array to an enum object.
     * @param {Object<string, string>} acc
     * @param {string} val
     * @returns {Object<string, string>}
     */
    (acc, val) => {
      acc[val.toUpperCase()] = val.toLowerCase();
      return acc;
    },
    {},
  );

export const SIGNATURE_PROVIDERS = Object.freeze({
  ...convertToEnum(providers),
});

export const SUPPORTED_PROVIDERS = Object.freeze(
  Object.values(SIGNATURE_PROVIDERS),
);

export const HASH_ALGORITHMS = Object.freeze({
  ...convertToEnum(algorithms),
});

export const SIGNATURE_ENCODINGS = Object.freeze({
  ...convertToEnum(encodings),
});

export const SIGNATURE_PREFIXES = Object.freeze({
  SHA1: "sha1=",
  SHA256: "sha256=",
  V0: "v0=",
  V0_NO_PREFIX: "v0",
});

export const SECURITY_CONSTS = Object.freeze({
  CSP_POLICY: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https://static.apify.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join("; "),
});

export const SECURITY_HEADERS_VALUES = Object.freeze({
  NOSNIFF: "nosniff",
  DENY: "DENY",
  REF_STRICT_ORIGIN: "strict-origin-when-cross-origin",
  IDENTITY: "identity",
  NO_CACHE: "no-cache",
  KEEP_ALIVE: "keep-alive",
  NO: "no",
  HSTS_HEADER: "Strict-Transport-Security",
  HSTS_VALUE: "max-age=31536000; includeSubDomains",
  PERMISSIONS_POLICY_HEADER: "Permissions-Policy",
  PERMISSIONS_POLICY_VALUE: "geolocation=(), microphone=(), camera=()",
});

export const SIGNATURE_CONSTS = Object.freeze({
  DEFAULT_PROVIDER: SIGNATURE_PROVIDERS.CUSTOM,
  TOLERANCE_SECONDS: getInt(
    "SIGNATURE_TOLERANCE_SECONDS",
    inputSchema.properties.signatureVerification.properties.tolerance.default,
  ),
  DEFAULT_ALGORITHM:
    inputSchema.properties.signatureVerification.properties.algorithm.default,
  DEFAULT_ENCODING:
    inputSchema.properties.signatureVerification.properties.encoding.default,
});
