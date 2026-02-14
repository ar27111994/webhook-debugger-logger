import { describe, test, expect, afterEach } from "@jest/globals";
import { tryParse, parseIfPresent } from "../../src/utils/common.js";
import { getInt } from "../../src/utils/env.js";

describe("Common Utils", () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("getInt", () => {
    test("should return fallback if env var is undefined", () => {
      delete process.env.TEST_INT;
      expect(getInt("TEST_INT", 5)).toBe(5);
    });

    test("should return fallback if env var is empty string", () => {
      process.env.TEST_INT = "";
      expect(getInt("TEST_INT", 5)).toBe(5);
    });

    test("should return parsed integer if valid positive number", () => {
      process.env.TEST_INT = "10";
      expect(getInt("TEST_INT", 5)).toBe(10);
    });

    test("should return fallback if input is not a number", () => {
      process.env.TEST_INT = "invalid";
      expect(getInt("TEST_INT", 5)).toBe(5);
    });

    test("should return fallback if input is negative (parsed >= 0 check)", () => {
      process.env.TEST_INT = "0";
      expect(getInt("TEST_INT", 5)).toBe(0); // 0 is valid non-negative integer

      process.env.TEST_INT = "-10";
      expect(getInt("TEST_INT", 5)).toBe(5);
    });

    test("should parse float as integer", () => {
      process.env.TEST_INT = "10.5";
      expect(getInt("TEST_INT", 5)).toBe(10);
    });
  });

  describe("tryParse", () => {
    test("should return object if input is already object", () => {
      const obj = { key: "value" };
      expect(tryParse(obj)).toBe(obj);
    });

    test("should return {} if input is null or undefined", () => {
      expect(tryParse(null)).toEqual({});
      expect(tryParse(undefined)).toEqual({});
    });

    test("should parse valid JSON string", () => {
      const json = '{"key": "value"}';
      expect(tryParse(json)).toEqual({ key: "value" });
    });

    test("should return original string if JSON is invalid", () => {
      const invalid = "{ key: value }"; // Invalid JSON
      expect(tryParse(invalid)).toBe(invalid);
    });

    test("should handle numeric string inputs correctly (parses as number)", () => {
      // JSON.parse("123") is 123.
      // tryParse("123") returns 123.
      expect(tryParse("123")).toBe(123);
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

    test("should verify it uses tryParse logic (e.g. invalid json returns string)", () => {
      const val = { data: "invalid" };
      expect(parseIfPresent("data", val)).toBe("invalid");
    });
  });
});
