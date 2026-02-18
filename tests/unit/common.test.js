import { describe, test, expect, afterEach } from "@jest/globals";
import {
  tryParse,
  parseIfPresent,
  validateStatusCode,
  deepRedact,
  validateUUID,
} from "../../src/utils/common.js";
import { getInt } from "../../src/utils/env.js";
import { HTTP_STATUS } from "../../src/consts/http.js";
import { LOG_CONSTS } from "../../src/consts/logging.js";
import { DEFAULT_ID_LENGTH } from "../../src/consts/app.js";
import { assertType } from "../setup/helpers/test-utils.js";

const ERR_CODE_INV = 999;
const NUM_INPUT = 123;
const LEN_CUST = 10;
const VAL_NON_OBJ = 42;
const PATH_REDACT = "body.password";
const V1 = 1;
const V2 = 2;
const V3 = 3;
const ARR_TEST = [V1, V2, V3];
const SEC_VAL = "secret_val";
const ABC_VAL = "abc_val";
const P_VAL = "p_val";
const T_VAL = "t_val";
const PF_VAL = "pf_val";

describe("Common Utils", () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("getInt", () => {
    const DEFAULT_INT = 5;
    const TEST_INT = 10;

    test("should return fallback if env var is undefined", () => {
      delete process.env.TEST_INT;
      expect(getInt("TEST_INT", DEFAULT_INT)).toBe(DEFAULT_INT);
    });

    test("should return fallback if env var is empty string", () => {
      process.env.TEST_INT = "";
      expect(getInt("TEST_INT", DEFAULT_INT)).toBe(DEFAULT_INT);
    });

    test("should return parsed integer if valid positive number", () => {
      process.env.TEST_INT = String(TEST_INT);
      expect(getInt("TEST_INT", DEFAULT_INT)).toBe(TEST_INT);
    });

    test("should return fallback if input is not a number", () => {
      process.env.TEST_INT = "invalid";
      expect(getInt("TEST_INT", DEFAULT_INT)).toBe(DEFAULT_INT);
    });

    test("should return fallback if input is negative (parsed >= 0 check)", () => {
      process.env.TEST_INT = "0";
      expect(getInt("TEST_INT", DEFAULT_INT)).toBe(0);

      process.env.TEST_INT = "-10";
      expect(getInt("TEST_INT", DEFAULT_INT)).toBe(DEFAULT_INT);
    });

    test("should parse float as integer", () => {
      process.env.TEST_INT = "10.5";
      expect(getInt("TEST_INT", DEFAULT_INT)).toBe(TEST_INT);
    });
  });

  describe("tryParse", () => {
    test("should return object if input is already object", () => {
      const obj = { key: "value" };
      expect(tryParse(obj)).toBe(obj);
    });

    test("should return same reference for arrays (arrays are objects)", () => {
      const arr = ARR_TEST;
      expect(tryParse(arr)).toBe(arr);
    });

    test("should return {} if input is null or undefined", () => {
      expect(tryParse(null)).toEqual({});
      expect(tryParse(undefined)).toEqual({});
    });

    test("should return {} if input is empty string (falsy)", () => {
      expect(tryParse("")).toEqual({});
    });

    test("should return {} if input is 0 (falsy)", () => {
      expect(tryParse(0)).toEqual({});
    });

    test("should return {} if input is false (falsy)", () => {
      expect(tryParse(false)).toEqual({});
    });

    test("should parse valid JSON string", () => {
      const json = '{"key": "value"}';
      expect(tryParse(json)).toEqual({ key: "value" });
    });

    test("should return original string if JSON is invalid", () => {
      const invalid = "{ key: value }";
      expect(tryParse(invalid)).toBe(invalid);
    });

    test("should handle numeric string inputs correctly (parses as number)", () => {
      expect(tryParse(String(NUM_INPUT))).toBe(NUM_INPUT);
    });

    test("should parse boolean string as boolean", () => {
      expect(tryParse("true")).toBe(true);
      expect(tryParse("false")).toBe(false);
    });

    test("should parse null string as null", () => {
      expect(tryParse("null")).toBeNull();
    });

    test("should parse array string as array", () => {
      expect(tryParse("[1,2,3]")).toEqual(ARR_TEST);
    });
  });

  describe("parseIfPresent", () => {
    test("should return undefined if key is missing", () => {
      expect(parseIfPresent("missing", {})).toBeUndefined();
    });

    test("should parse value if key exists", () => {
      const val = { data: '{"a":1}' };
      expect(parseIfPresent("data", val)).toEqual({ a: 1 });
    });

    test("should verify it uses tryParse logic (invalid json returns string)", () => {
      const val = { data: "invalid" };
      expect(parseIfPresent("data", val)).toBe("invalid");
    });

    test("should return object if value is already an object", () => {
      const nested = { x: 1 };
      const val = { data: nested };
      expect(parseIfPresent("data", val)).toBe(nested);
    });

    test("should handle null value for existing key", () => {
      const val = { data: null };
      expect(parseIfPresent("data", val)).toEqual({});
    });

    test("should handle undefined value for existing key", () => {
      const val = { data: undefined };
      expect(parseIfPresent("data", val)).toBeUndefined();
    });
  });

  describe("validateStatusCode", () => {
    test("should accept valid HTTP status codes from HTTP_STATUS", () => {
      expect(validateStatusCode(HTTP_STATUS.OK)).toBe(true);
      expect(validateStatusCode(HTTP_STATUS.NOT_FOUND)).toBe(true);
      expect(validateStatusCode(HTTP_STATUS.INTERNAL_SERVER_ERROR)).toBe(true);
      expect(validateStatusCode(HTTP_STATUS.BAD_REQUEST)).toBe(true);
      expect(validateStatusCode(HTTP_STATUS.UNAUTHORIZED)).toBe(true);
    });

    test("should reject non-standard status codes", () => {
      expect(validateStatusCode(ERR_CODE_INV)).toBe(false);
      expect(validateStatusCode(0)).toBe(false);
      expect(validateStatusCode(-1)).toBe(false);
      expect(validateStatusCode(1)).toBe(false);
    });

    test("should reject NaN", () => {
      expect(validateStatusCode(NaN)).toBe(false);
    });

    test("should reject Infinity and -Infinity", () => {
      expect(validateStatusCode(Infinity)).toBe(false);
      expect(validateStatusCode(-Infinity)).toBe(false);
    });
  });

  describe("deepRedact", () => {
    test("should redact a top-level key with default censor", () => {
      const obj = { password: PF_VAL };
      deepRedact(obj, ["password"]);
      expect(obj.password).toBe(LOG_CONSTS.CENSOR_MARKER);
    });

    test("should redact nested keys using dot notation", () => {
      const obj = { body: { user: { password: SEC_VAL } } };
      deepRedact(obj, ["body.user.password"]);
      expect(obj.body.user.password).toBe(LOG_CONSTS.CENSOR_MARKER);
    });

    test("should accept a custom censor value", () => {
      const customCensor = "***";
      const obj = { apiKey: ABC_VAL };
      deepRedact(obj, ["apiKey"], customCensor);
      expect(obj.apiKey).toBe(customCensor);
    });

    test("should skip paths that do not exist in the object", () => {
      const obj = { name: "test" };
      const originalObj = { ...obj };
      deepRedact(obj, ["nonExistent.deeply.nested"]);
      expect(obj).toEqual(originalObj);
    });

    test("should skip paths where intermediate segment is not an object", () => {
      const obj = { body: "not-an-object" };
      const original = { ...obj };
      deepRedact(obj, [PATH_REDACT]);
      expect(obj).toEqual(original);
    });

    test("should skip paths where intermediate segment is null", () => {
      const obj = { body: null };
      deepRedact(obj, [PATH_REDACT]);
      expect(obj.body).toBeNull();
    });

    test("should handle multiple paths in one call", () => {
      const obj = {
        password: P_VAL,
        token: T_VAL,
        name: "safe",
      };
      deepRedact(obj, ["password", "token"]);
      expect(obj.password).toBe(LOG_CONSTS.CENSOR_MARKER);
      expect(obj.token).toBe(LOG_CONSTS.CENSOR_MARKER);
      expect(obj.name).toBe("safe");
    });

    test("should do nothing if obj is null or undefined", () => {
      expect(() => deepRedact(assertType(null), ["a"])).not.toThrow();
      expect(() => deepRedact(assertType(undefined), ["a"])).not.toThrow();
    });

    test("should do nothing if obj is not an object", () => {
      expect(() => deepRedact(assertType("string"), ["a"])).not.toThrow();
      expect(() => deepRedact(assertType(VAL_NON_OBJ), ["a"])).not.toThrow();
    });

    test("should do nothing if paths is not an array", () => {
      const obj = { key: "value" };
      expect(() => deepRedact(obj, assertType("notAnArray"))).not.toThrow();
      expect(obj.key).toBe("value");
    });

    test("should handle empty paths array", () => {
      const obj = { key: "value" };
      deepRedact(obj, []);
      expect(obj.key).toBe("value");
    });

    test("should not redact key if last key does not exist", () => {
      const obj = { body: { name: "test" } };
      deepRedact(obj, [PATH_REDACT]);
      expect(obj.body.name).toBe("test");
      expect(obj.body).not.toHaveProperty("password");
    });

    test("should handle path with broken intermediate segment (key missing)", () => {
      const obj = { a: {} };
      deepRedact(obj, ["a.b.c"]);
      expect(obj.a).toEqual({});
    });
  });

  describe("validateUUID", () => {
    test("should accept a valid nanoid of default length", () => {
      const validChars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
      const validId = validChars.slice(0, DEFAULT_ID_LENGTH);
      expect(validateUUID(validId)).toBe(true);
    });

    test("should reject string with wrong length", () => {
      expect(validateUUID("abc")).toBe(false);
      expect(validateUUID("a".repeat(DEFAULT_ID_LENGTH + 1))).toBe(false);
    });

    test("should reject string with invalid characters", () => {
      const invalidId = "@!#$%^&*()+={}[]".padEnd(DEFAULT_ID_LENGTH, "a");
      expect(validateUUID(invalidId)).toBe(false);
    });

    test("should reject non-string inputs", () => {
      expect(validateUUID(assertType(NUM_INPUT))).toBe(false);
      expect(validateUUID(assertType(null))).toBe(false);
      expect(validateUUID(assertType(undefined))).toBe(false);
      expect(validateUUID(assertType({}))).toBe(false);
      expect(validateUUID(assertType([]))).toBe(false);
    });

    test("should accept custom length parameter", () => {
      const validId = "abcdefghij";
      expect(validateUUID(validId, LEN_CUST)).toBe(true);
    });

    test("should reject empty string", () => {
      expect(validateUUID("")).toBe(false);
    });

    test("should handle length=0 parameter by using DEFAULT_ID_LENGTH", () => {
      const validId = "A".repeat(DEFAULT_ID_LENGTH);
      expect(validateUUID(validId, 0)).toBe(true);
    });

    test("should accept strings containing underscore and hyphen", () => {
      const idWithSpecials = "_-".padEnd(DEFAULT_ID_LENGTH, "a");
      expect(validateUUID(idWithSpecials)).toBe(true);
    });
  });
});
