import { describe, test, expect } from "@jest/globals";
import { getInt } from "../../src/utils/env.js";

describe("utils/env.js", () => {
  const originalEnv = { ...process.env };
  const DEFAULT_VAL = 10;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("getInt should return parsed integer", () => {
    const TEST_VAL = 42;
    process.env.TEST_INT = String(TEST_VAL);
    expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(TEST_VAL);
  });

  test("getInt should return fallback for missing key", () => {
    delete process.env.TEST_INT;
    expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
  });

  test("getInt should return fallback for empty string", () => {
    process.env.TEST_INT = "";
    expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
  });

  test("getInt should return fallback for non-number string", () => {
    process.env.TEST_INT = "abc";
    expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
  });

  test("getInt should return fallback for negative number", () => {
    process.env.TEST_INT = "-1";
    expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(DEFAULT_VAL);
  });

  test("getInt should return parsed integer for zero", () => {
    process.env.TEST_INT = "0";
    expect(getInt("TEST_INT", DEFAULT_VAL)).toBe(0);
  });
});
