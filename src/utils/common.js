/**
 * @file src/utils/common.js
 * @description Shared utility functions for environment parsing and JSON handling.
 * @module utils/common
 */

import { DEFAULT_ID_LENGTH } from "../consts/app.js";
import { HTTP_STATUS } from "../consts/http.js";
import { LOG_CONSTS } from "../consts/logging.js";

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

/**
 * Helper to validate an HTTP Status Code
 * @param {number} statusCode
 * @returns {boolean}
 */
export function validateStatusCode(statusCode) {
  return (
    !Number.isNaN(statusCode) &&
    Number.isFinite(statusCode) &&
    Object.values(HTTP_STATUS).map(Number).includes(statusCode)
  );
}

/**
 * Recursively redacts keys in an object based on dot-separated paths.
 * @param {Object.<string, any>} obj - The object to redact properties from.
 * @param {string[]} paths - Array of dot-separated paths to redact (e.g. "body.user.password").
 * @param {string} [censor=$`{LOG_CONSTS.CENSOR_MARKER}`] - The value to replace redacted data with.
 * @returns {void} - Mutates the object in place.
 */
export function deepRedact(obj, paths, censor = LOG_CONSTS.CENSOR_MARKER) {
  if (!obj || typeof obj !== "object" || !Array.isArray(paths)) return;

  for (const path of paths) {
    const parts = path.split(".");
    let current = obj;
    let pathBroken = false;

    // Traverse to the second-to-last key
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      // Safety check: key exists, and value is a non-null object
      if (
        current &&
        Object.prototype.hasOwnProperty.call(current, key) &&
        typeof current[key] === "object" &&
        current[key] !== null
      ) {
        current = current[key];
      } else {
        // Path does not exist or is broken; skip to next path
        pathBroken = true;
        break;
      }
    }

    if (pathBroken) continue;

    if (current) {
      const lastKey = parts[parts.length - 1];
      if (Object.prototype.hasOwnProperty.call(current, lastKey)) {
        current[lastKey] = censor;
      }
    }
  }
}

/**
 * Helper to validate a UUID
 * @param {string} uuid
 * @param {number} [length=DEFAULT_ID_LENGTH]
 * @returns {boolean}
 */
export function validateUUID(uuid, length = DEFAULT_ID_LENGTH) {
  // Assuming you use the default parameters:
  const NANOID_LENGTH = length || DEFAULT_ID_LENGTH;
  // Default alphabet includes A-Za-z0-9_-
  const NANOID_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

  if (typeof uuid !== "string") {
    return false;
  }
  // Create a regex pattern dynamically
  const regex = new RegExp(`^[${NANOID_ALPHABET}]+$`);

  // Check characters and length
  return regex.test(uuid) && uuid.length === NANOID_LENGTH;
}
