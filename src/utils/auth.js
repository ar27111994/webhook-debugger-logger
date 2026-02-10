/**
 * @file src/utils/auth.js
 * @description Authentication utilities for validating API keys.
 * @module utils/auth
 */
import { secureCompare } from "./crypto.js";
import { createChildLogger } from "./logger.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { AUTH_CONSTS, AUTH_ERRORS } from "../consts/auth.js";
import { HTTP_HEADERS } from "../consts/http.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('../typedefs.js').ValidationResult} ValidationResult
 */

const log = createChildLogger({ component: LOG_COMPONENTS.AUTH });

/**
 * Validates the authentication key from query or headers.
 *
 * @param {Request} req - Express request object
 * @param {string} [authKey] - The configured authentication key
 * @returns {ValidationResult} Validation result
 */
export function validateAuth(req, authKey) {
  if (!authKey) {
    return { isValid: true };
  }

  // 1. Extract token from Authorization header (Preferred)
  const authHeaderRaw = req.headers[HTTP_HEADERS.AUTHORIZATION];
  if (Array.isArray(authHeaderRaw) && authHeaderRaw.length > 1) {
    return {
      isValid: false,
      error: AUTH_ERRORS.MULTIPLE_HEADERS,
    };
  }
  const authHeader = Array.isArray(authHeaderRaw)
    ? (authHeaderRaw[0] ?? "")
    : (authHeaderRaw ?? "");
  let providedKey = "";

  if (authHeader.toLowerCase().startsWith(AUTH_CONSTS.BEARER_PREFIX)) {
    providedKey = authHeader.substring(AUTH_CONSTS.BEARER_PREFIX.length).trim();
  } else if (req.query.key) {
    // 2. Fallback to query param (Deprecated/Riskier)
    const rawKey = Array.isArray(req.query.key)
      ? req.query.key[0]
      : req.query.key;
    if (typeof rawKey === "string") providedKey = rawKey.trim();
    else providedKey = String(rawKey);

    log.warn(LOG_MESSAGES.API_KEY_QUERY_WARNING);
  }

  if (!providedKey) {
    return {
      isValid: false,
      error: AUTH_ERRORS.MISSING_KEY,
    };
  }

  // 3. Timing-safe comparison
  const isValid = secureCompare(authKey, providedKey);

  if (!isValid) {
    return {
      isValid: false,
      error: AUTH_ERRORS.UNAUTHORIZED_KEY,
    };
  }

  return { isValid: true };
}
