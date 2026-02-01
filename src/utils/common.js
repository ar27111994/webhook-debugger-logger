/**
 * @file src/utils/common.js
 * @description Shared utility functions for environment parsing and JSON handling.
 */

/**
 * Helper to safely parse integer environment variables
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 *
 * @example const maxRetries = getInt("MAX_RETRIES", 3);
 */
export function getInt(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === "") return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Helper to try parsing JSON
 * @param {any} val
 */
export function tryParse(val) {
  if (typeof val === "object" && val !== null) return val;
  if (!val) return {};

  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

/**
 * Helper to conditionally parse if the field exists in the row
 * @param {string} key
 * @param {Record<string, any>} val
 * @returns {any}
 */
export function parseIfPresent(key, val) {
  return val[key] !== undefined ? tryParse(val[key]) : undefined;
}
