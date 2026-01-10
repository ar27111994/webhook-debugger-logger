import { timingSafeEqual } from "crypto";

/**
 * Validates the authentication key from query or headers.
 *
 * @param {import('express').Request} req - Express request object
 * @param {string} authKey - The configured authentication key
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
    console.warn(
      "[SECURITY] API key provided in query string. Use Authorization header instead.",
    );
  }

  if (!providedKey) {
    return {
      isValid: false,
      error: "Unauthorized: Missing API key",
    };
  }

  // 3. Timing-safe comparison
  const expectedBuffer = Buffer.from(authKey);
  const providedBuffer = Buffer.from(providedKey);

  // timingSafeEqual requires buffers of the same length
  if (expectedBuffer.length !== providedBuffer.length) {
    // Perform a dummy comparison to avoid a simple timing shortcut
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return {
      isValid: false,
      error: "Unauthorized: Invalid API key",
    };
  }

  const isValid = timingSafeEqual(expectedBuffer, providedBuffer);

  if (!isValid) {
    return {
      isValid: false,
      error: "Unauthorized: Invalid API key",
    };
  }

  return { isValid: true };
}
