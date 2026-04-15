/**
 * @file tests/unit/utils/env.test.js
 * @description Unit tests for environment variable utility functions.
 */

import { jest } from "@jest/globals";
import { getInt, IS_TEST } from "../../../src/utils/env.js";
import { ENV_VALUES, ENV_VARS } from "../../../src/consts/app.js";

const DEFAULT_VAL = 10;
const TEST_INT_VAL = 42;
const TEST_FLOAT_VAL = 12; // integer part of 12.34

describe("Env Utils", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("getInt", () => {
    it("should return parsed integer for valid numeric string", () => {
      process.env.TEST_INT = String(TEST_INT_VAL);
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(TEST_INT_VAL);
    });

    it("should return fallback if environment variable is undefined", () => {
      delete process.env.TEST_INT;
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
    });

    it("should return fallback if environment variable is empty string", () => {
      process.env.TEST_INT = "";
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
    });

    it("should return fallback for non-numeric strings", () => {
      process.env.TEST_INT = "invalid";
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
    });

    it("should return fallback for negative numbers (per implementation constraints)", () => {
      // Implementation requires >= 0
      process.env.TEST_INT = "-5";
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
    });

    it('should handle "0" correctly (falsy value edge case)', () => {
      process.env.TEST_INT = "0";
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(0);
    });

    it("should parse floats as integers (parseInt behavior)", () => {
      process.env.TEST_INT = "12.34";
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(TEST_FLOAT_VAL);
    });

    it('should return fallback for "Infinity" as parseInt treats it as NaN', () => {
      process.env.TEST_INT = "Infinity";
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
    });

    it("should handle whitespace by parsing valid integer logic (parseInt ignores leading/trailing)", () => {
      const TEST_INT = 42;
      process.env.TEST_INT = `  ${TEST_INT}  `;
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(TEST_INT);
    });

    it('should parse "1e3" as 1 (standard parseInt behavior edge case)', () => {
      // Documenting potential gotcha: parseInt("1e3") is 1, not 1000.
      const TEST_INT = 1;
      process.env.TEST_INT = `${TEST_INT}e3`;
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(TEST_INT);
    });

    it("should handle MAX_SAFE_INTEGER interactions", () => {
      process.env.TEST_INT = String(Number.MAX_SAFE_INTEGER);
      expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("IS_TEST", () => {
    it("should return true when NODE_ENV is set to test", () => {
      // NODE_ENV is set to test by default in the test environment
      expect(IS_TEST()).toBe(true);
    });

    it("should return false when NODE_ENV is not set to test", () => {
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
      expect(IS_TEST()).toBe(false);

      process.env[ENV_VARS.NODE_ENV] = "development";
      expect(IS_TEST()).toBe(false);

      delete process.env[ENV_VARS.NODE_ENV];
      expect(IS_TEST()).toBe(false);
    });
  });
});
