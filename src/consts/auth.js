/**
 * @file src/consts/auth.js
 * @description Authentication related constants and patterns.
 * @module consts/auth
 */

import { HTTP_HEADERS } from "./http.js";

/**
 * @type {Readonly<{BEARER_PREFIX: string, HEADER_READINESS_PROBE: string}>}
 */
export const AUTH_CONSTS = Object.freeze({
  BEARER_PREFIX: "bearer ",
  HEADER_READINESS_PROBE: HTTP_HEADERS.APIFY_READINESS,
});

/**
 * @enum {string}
 */
export const AUTH_ERRORS = Object.freeze({
  UNAUTHORIZED_KEY: "Unauthorized: Invalid API key",
  MISSING_KEY: "Unauthorized: Missing API key",
  MULTIPLE_HEADERS: "Multiple Authorization headers are not allowed",
});

/**
 * @enum {string}
 */
export const AUTH_PLACEHOLDERS = Object.freeze({
  ERROR_MESSAGE: "{{ERROR_MESSAGE}}",
  APIFY_HOMEPAGE_URL: "{{APIFY_HOMEPAGE_URL}}",
});
