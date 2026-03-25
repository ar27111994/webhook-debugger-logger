/**
 * @file src/utils/env.js
 * @description Lightweight helpers for environment variable parsing.
 * This file is dependency-free to allow usage in constants without circular dependencies.
 * @module utils/env
 */

import { ENV_VALUES, ENV_VARS } from "../consts/app.js";

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

