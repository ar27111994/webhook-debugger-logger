/**
 * @file src/utils/env.js
 * @description Lightweight helpers for environment variable parsing.
 * This file is dependency-free to allow usage in constants without circular dependencies.
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
