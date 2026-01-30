import { secureCompare } from "./crypto.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger({ component: "Auth" });

/**
 * Validates the authentication key from query or headers.
 *
 * @param {import('express').Request} req - Express request object
 * @param {string | undefined} authKey - The configured authentication key
 * @returns {import('../typedefs.js').ValidationResult} Validation result
 */
export function validateAuth(req, authKey) {
  if (!authKey) {
    return { isValid: true };
  }

  // 1. Extract token from Authorization header (Preferred)
  const authHeaderRaw = req.headers["authorization"];
  if (Array.isArray(authHeaderRaw) && authHeaderRaw.length > 1) {
    return {
      isValid: false,
      error: "Multiple Authorization headers are not allowed",
    };
  }
  const authHeader = Array.isArray(authHeaderRaw)
    ? (authHeaderRaw[0] ?? "")
    : (authHeaderRaw ?? "");
  let providedKey = "";

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    providedKey = authHeader.substring(7).trim();
  } else if (req.query.key) {
    // 2. Fallback to query param (Deprecated/Riskier)
    const rawKey = Array.isArray(req.query.key)
      ? req.query.key[0]
      : req.query.key;
    if (typeof rawKey === "string") providedKey = rawKey.trim();
    log.warn(
      "API key provided in query string, use Authorization header instead",
    );
  }

  if (!providedKey) {
    return {
      isValid: false,
      error: "Unauthorized: Missing API key",
    };
  }

  // 3. Timing-safe comparison
  const isValid = secureCompare(authKey, providedKey);

  if (!isValid) {
    return {
      isValid: false,
      error: "Unauthorized: Invalid API key",
    };
  }

  return { isValid: true };
}
