import { checkIpInRanges } from "./ssrf.js";

/**
 * @typedef {Object} RangeCondition
 * @property {string} operator - One of 'gt', 'gte', 'lt', 'lte', 'ne', 'eq'
 * @property {number|string} value
 */

/**
 * @typedef {import('../typedefs.js').QueryValue} QueryValue
 */

/**
 * Valid operators whitelist
 */
const VALID_OPERATORS = ["gt", "gte", "lt", "lte", "ne", "eq"];

/**
 * Parses a query parameter into range conditions.
 * Handles both simple values ("200") and object operators ({ gt: "200" }).
 *
 * @param {string|Object|undefined} queryParam
 * @param {'number'|'string'} [type='number'] - Value type for parsing
 * @returns {RangeCondition[]}
 */
export function parseRangeQuery(queryParam, type = "number") {
  if (queryParam === undefined || queryParam === null || queryParam === "") {
    return [];
  }

  /**
   * @param {string|number} val
   * @returns {string|number|null}
   */
  const parseValue = (val) => {
    if (type === "string") return String(val);
    const num = Number(val);
    return isNaN(num) ? null : num;
  };

  // Handle direct equality (field=200)
  if (typeof queryParam !== "object") {
    const val = parseValue(queryParam);
    if (val !== null) {
      return [{ operator: "eq", value: val }];
    }
    return [];
  }

  // Handle operators (field[gt]=200)
  // Express/qs parses field[gt]=200 as { gt: "200" }
  const conditions = [];
  for (const [op, rawVal] of Object.entries(queryParam)) {
    if (!VALID_OPERATORS.includes(op)) continue;
    const val = parseValue(rawVal);
    if (val !== null) {
      conditions.push({ operator: op, value: val });
    }
  }

  return conditions;
}

/**
 * Checks if a value satisfies all range conditions.
 *
 * @param {number|string} value
 * @param {RangeCondition[]} conditions
 * @returns {boolean}
 */
export function matchesRange(value, conditions) {
  if (!conditions || conditions.length === 0) return true;
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "number" && isNaN(value)) return false;

  return conditions.every(({ operator, value: target }) => {
    switch (operator) {
      case "gt":
        return value > target;
      case "gte":
        return value >= target;
      case "lt":
        return value < target;
      case "lte":
        return value <= target;
      case "ne":
        return value !== target;
      case "eq":
        return value === target;
      default:
        return true;
    }
  });
}

/**
 * Checks if a client IP matches a filter string (exact IP or CIDR).
 *
 * @param {string} clientIp
 * @param {string} filterIp - Can be "1.2.3.4" or "1.2.3.0/24"
 * @returns {boolean}
 */
export function matchesIp(clientIp, filterIp) {
  if (!filterIp) return true;
  if (!clientIp) return false;

  // Utilize robust checkIpInRanges from ssrf.js
  // It handles both single IPs and CIDR ranges correctly
  return checkIpInRanges(clientIp, [filterIp]);
}

/**
 * Helper to parse object-like filters (headers, query)
 * @param {QueryValue} input
 * @returns {Record<string, string> | string | null}
 */
export function parseObjectFilter(input) {
  if (!input) return null;
  if (typeof input === "string") return input.toLowerCase();
  if (typeof input === "object" && !Array.isArray(input)) {
    /** @type {Record<string, string>} */
    const obj = {};
    for (const [k, v] of Object.entries(input)) {
      if (v) obj[k.toLowerCase()] = String(v).toLowerCase();
    }
    return obj;
  }
  return null;
}

/**
 * Helper function to match object fields against a filter.
 * @param {any} itemObj
 * @param {Record<string, string> | string | null} filterObj
 */
export function matchObject(itemObj, filterObj) {
  if (!filterObj) return true;
  const target = itemObj || {};
  if (typeof filterObj === "string") {
    // Avoid double-encoding if target is already a string
    const targetStr =
      typeof target === "string" ? target : JSON.stringify(target);
    return targetStr.toLowerCase().includes(filterObj);
  }
  for (const [key, searchVal] of Object.entries(filterObj)) {
    const itemVal = target[key];
    if (!itemVal || !String(itemVal).toLowerCase().includes(searchVal)) {
      return false;
    }
  }
  return true;
}
