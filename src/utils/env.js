/**
 * @file src/utils/env.js
 * @description Lightweight helpers for environment variable parsing.
 * Also triggers one-time local .env loading for CLI/self-hosted usage.
 * Keep the side-effect import here because multiple constants modules read
 * environment-backed defaults during module evaluation, including code paths
 * that do not boot through src/main.js.
 * @module utils/env
 */

import "./load_env.js";
import { ENV_VALUES, ENV_VARS } from "../consts/env.js";

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
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Checks if the current environment is a test environment.
 * @returns {boolean}
 * 
 * @example const isTest = IS_TEST();
 */
export const IS_TEST = () => process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST;

