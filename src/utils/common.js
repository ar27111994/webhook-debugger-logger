/**
 * @file src/utils/common.js
 * @description Shared utility functions for environment parsing and JSON handling.
 */

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
