import { describe, test, expect } from "@jest/globals";
import {
  ERROR_MESSAGES,
  SIGNATURE_ERRORS,
  ERROR_LABELS,
  NODE_ERROR_CODES,
} from "../../src/consts/errors.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";

const IDX_FIRST = 0;
const VAL_NUMERIC = 123;
const RETRY_LIMIT = 3;
const TYPE_STR = "string";
const ARG_DUMMY = "dummy";
const MSG_VALID_VALUES = "should have valid string or function values";
const MSG_VALID_STRINGS = "should have valid string values";

/**
 * Executes a function with dummy arguments based on its length (arity).
 * @param {Function} fn
 * @returns {any}
 */
const executeWithDummyArgs = (fn) => {
  const dummyArgs = Array(fn.length).fill(ARG_DUMMY);
  // Some functions might expect numbers
  const safeArgs = dummyArgs.map((_, i) =>
    i === IDX_FIRST ? VAL_NUMERIC : ARG_DUMMY,
  );
  return fn(...safeArgs);
};

/**
 * Verifies that all properties of an object are strings or functions that return strings.
 * @param {Object<string, string | Function>} obj
 */
const verifyObjectProperties = (obj) => {
  Object.entries(obj).forEach(([_key, value]) => {
    if (typeof value === "function") {
      expect(typeof executeWithDummyArgs(value)).toBe(TYPE_STR);
    } else {
      expect(typeof value).toBe(TYPE_STR);
    }
  });
};

describe("Consts Functional Coverage", () => {
  describe("ERROR_MESSAGES", () => {
    test(MSG_VALID_VALUES, () => {
      verifyObjectProperties(ERROR_MESSAGES);
    });

    // Specific branch coverage for template logic
    test("FORWARD_FAILURE_DETAILS should handle transient/non-transient flags", () => {
      const msgTransient = ERROR_MESSAGES.FORWARD_FAILURE_DETAILS(
        "url",
        true,
        RETRY_LIMIT,
        "err",
      );
      expect(msgTransient).not.toContain("Non-transient error");

      const msgNonTransient = ERROR_MESSAGES.FORWARD_FAILURE_DETAILS(
        "url",
        false,
        RETRY_LIMIT,
        "err",
      );
      expect(msgNonTransient).toContain("Non-transient error");
    });
  });

  describe("SIGNATURE_ERRORS", () => {
    test(MSG_VALID_VALUES, () => {
      verifyObjectProperties(SIGNATURE_ERRORS);
    });
  });

  describe("ERROR_LABELS", () => {
    test(MSG_VALID_STRINGS, () => {
      verifyObjectProperties(ERROR_LABELS);
    });
  });

  describe("NODE_ERROR_CODES", () => {
    test(MSG_VALID_STRINGS, () => {
      verifyObjectProperties(NODE_ERROR_CODES);
    });
  });

  describe("LOG_MESSAGES", () => {
    test(MSG_VALID_VALUES, () => {
      verifyObjectProperties(LOG_MESSAGES);
    });
  });
});
