/**
 * @file tests/unit/common.test.js
 * @description Unit tests for common utility functions logic.
 */

import { DEFAULT_ID_LENGTH } from "../../src/consts/app.js";
import { LOG_CONSTS } from "../../src/consts/logging.js";
import {
  tryParse,
  parseIfPresent,
  validateStatusCode,
  deepRedact,
  validateUUID,
} from "../../src/utils/common.js";
import { assertType } from "../setup/helpers/test-utils.js";

const MOCK_PORT = 123;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_MAX_VALID = 599;
const HTTP_MIN_INVALID = 99;
const HTTP_MAX_INVALID = 600;
const UUID_V4_LENGTH = 36;

describe("Common Utils", () => {
  describe("tryParse", () => {
    it("should parse valid JSON string", () => {
      const input = '{"key":"value"}';
      expect(tryParse(input)).toEqual({ key: "value" });
    });

    it("should return input for invalid JSON string", () => {
      const input = "{invalid}";
      expect(tryParse(input)).toBe(input);
    });

    it("should return input if it is already an object", () => {
      const input = { a: 1 };
      expect(tryParse(input)).toBe(input);
    });

    it("should return empty object for undefined input", () => {
      expect(tryParse(undefined)).toEqual({});
    });

    it("should return empty object for null input", () => {
      expect(tryParse(null)).toEqual({});
    });

    it("should return number for numeric input", () => {
      expect(tryParse(MOCK_PORT)).toBe(MOCK_PORT);
    });
  });

  describe("parseIfPresent", () => {
    it("should parse value if key exists", () => {
      const row = { data: '{"a":1}' };
      expect(parseIfPresent("data", row)).toEqual({ a: 1 });
    });

    it("should return undefined if key is missing", () => {
      const row = { other: 1 };
      expect(parseIfPresent("data", row)).toBeUndefined();
    });

    it("should handle non-JSON values by returning them as is (tryParse behavior)", () => {
      const row = { data: "simple string" };
      expect(parseIfPresent("data", row)).toBe("simple string");
    });
  });

  describe("validateStatusCode", () => {
    it("should return true for valid status codes", () => {
      expect(validateStatusCode(HTTP_OK)).toBe(true);
      expect(validateStatusCode(HTTP_NOT_FOUND)).toBe(true);
    });

    it("should return false for out of range or undefined codes", () => {
      expect(validateStatusCode(HTTP_MIN_INVALID)).toBe(false);
      expect(validateStatusCode(HTTP_MAX_INVALID)).toBe(false);
      expect(validateStatusCode(HTTP_MAX_VALID)).toBe(false); // 599 is not a defined status code in our enum
    });

    it("should return false for non-numeric input", () => {
      expect(validateStatusCode(JSON.parse('"200"'))).toBe(false);
      expect(validateStatusCode(JSON.parse("null"))).toBe(false);
    });
  });

  describe("deepRedact", () => {
    const SENSITIVE_VAL = "sensitive-value";
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords
    const PASSWORD_VAL = "password123";

    it("should redact sensitive keys", () => {
      const obj = {
        password: PASSWORD_VAL,
        apiKey: SENSITIVE_VAL,
        other: "value",
      };
      // deepRedact mutates in place and returns void
      deepRedact(obj, ["password", "apiKey"]);
      expect(obj.password).toBe(LOG_CONSTS.CENSOR_MARKER);
      expect(obj.apiKey).toBe(LOG_CONSTS.CENSOR_MARKER);
      expect(obj.other).toBe("value");
    });

    it("should redact nested keys", () => {
      const obj = { auth: { token: "123" }, meta: { id: 1 } };
      deepRedact(obj, ["auth.token"]);
      expect(obj).toEqual({
        auth: { token: LOG_CONSTS.CENSOR_MARKER },
        meta: { id: 1 },
      });
    });

    it("should handle broken paths safely", () => {
      const obj = { a: 1 };
      // 'a' is not an object, so cannot traverse 'a.b'
      deepRedact(obj, ["a.b"]);
      expect(obj).toEqual({ a: 1 });

      // 'x' does not exist
      deepRedact(obj, ["x.y"]);
      expect(obj).toEqual({ a: 1 });
    });

    it("should handle arrays of objects using explicit paths", () => {
      const obj = { items: [{ secret: "A" }, { secret: "B" }] };
      // deepRedact mutates in place
      deepRedact(obj, ["items.0.secret", "items.1.secret"]);
      expect(obj).toEqual({
        items: [
          { secret: LOG_CONSTS.CENSOR_MARKER },
          { secret: LOG_CONSTS.CENSOR_MARKER },
        ],
      });
    });

    it("should handle null/undefined input gracefully", () => {
      expect(deepRedact(JSON.parse("null"), [])).toBeUndefined();
      expect(deepRedact(assertType(undefined), [])).toBeUndefined();
    });

    it("should NOT redact inherited properties (prototype protection)", () => {
      const proto = { secret: "inherited-secret" };
      const obj = Object.create(proto);
      obj.ownSecret = "own-value";

      deepRedact(obj, ["secret", "ownSecret"]);

      // "secret" is on prototype, should remain untouched (hasOwnProperty check)
      expect(obj.secret).toBe("inherited-secret");
      // "ownSecret" is own property, should be redacted
      expect(obj.ownSecret).toBe(LOG_CONSTS.CENSOR_MARKER);
    });

    it("should handle paths that encounter non-object intermediates", () => {
      const obj = { start: { end: "val" } };
      // Path 'start.middle.end' where 'start' exists but 'middle' does not
      deepRedact(obj, ["start.middle.end"]);
      expect(obj).toEqual({ start: { end: "val" } });
    });
  });

  describe("validateUUID", () => {
    it("should return true for valid UUID v4", () => {
      // Verify actual behavior of validateUUID (default is 21 chars, this is 36)
      expect(
        validateUUID("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", UUID_V4_LENGTH),
      ).toBe(true);
    });

    it("should return false for invalid strings", () => {
      expect(validateUUID("invalid-uuid")).toBe(false);
      expect(validateUUID("123")).toBe(false);
    });

    it("should return false for non-string input", () => {
      expect(validateUUID(JSON.parse(String(MOCK_PORT)))).toBe(false);
      expect(validateUUID(JSON.parse("null"))).toBe(false);
    });

    it("should use default length (21) when no length provider", () => {
      // Default ID length is 21
      const validDefaultId = "A".repeat(DEFAULT_ID_LENGTH);
      expect(validateUUID(validDefaultId)).toBe(true);
      expect(validateUUID("short")).toBe(false);
    });

    it("should return false if ID length does not match provided length", () => {
      const invalidId = "abc";
      const invalidLength = 5;
      expect(validateUUID(invalidId, invalidLength)).toBe(false);
    });

    it("should handle length 0 edge case", () => {
      // If length is explicitly 0, it should invalidate empty string
      // if I pass uuid '', length is 0. 0 !== 21. False.
      expect(validateUUID("", 0)).toBe(false);
    });
  });
});
