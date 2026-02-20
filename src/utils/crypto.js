/**
 * @file src/utils/crypto.js
 * @description Cryptographic utilities for secure string comparison.
 * @module utils/crypto
 */
import crypto from "crypto";

/**
 * Performs a timing-safe string comparison to prevent timing attacks.
 * Handles variable-length inputs securely by ensuring constant-time execution
 * relative to the expected value's length.
 *
 * @param {string} expected - The secret/expected value
 * @param {string} actual - The user-provided value
 * @returns {boolean} True if values match, false otherwise
 */
export function secureCompare(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  // 1. Safe Length Check: If lengths differ, compare against a dummy buffer of valid length
  // This ensures timingSafeEqual is always called, preventing optimization based on length check
  const safeBuffer =
    expectedBuffer.length === actualBuffer.length
      ? actualBuffer
      : Buffer.alloc(expectedBuffer.length);

  // 2. Constant-Time Comparison
  // Note: timingSafeEqual throws if lengths differ, so we use safeBuffer
  const isContentMatch = crypto.timingSafeEqual(expectedBuffer, safeBuffer);

  // 3. Final Result: Content matches AND original lengths matched
  return isContentMatch && expectedBuffer.length === actualBuffer.length;
}
