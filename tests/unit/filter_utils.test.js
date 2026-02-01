import { describe, test, expect } from "@jest/globals";
import { jest } from "@jest/globals";
import { assertType } from "../setup/helpers/test-utils.js";

// Mock ssrf dependency
jest.unstable_mockModule("../../src/utils/ssrf.js", () => ({
  checkIpInRanges: jest.fn(
    /**
     * @param {string} ip
     * @param {string[]} ranges
     * @returns {boolean}
     */
    (ip, ranges) => {
      if (ranges.includes("10.0.0.0/8")) return ip === "10.0.0.1";
      return ip === ranges[0];
    },
  ),
}));

const { checkIpInRanges } = await import("../../src/utils/ssrf.js");
const {
  parseRangeQuery,
  matchesRange,
  matchesIp,
  matchObject,
  parseObjectFilter,
} = await import("../../src/utils/filter_utils.js");

describe("Filter Utils Tests", () => {
  describe("parseRangeQuery", () => {
    test("should return empty array for null/undefined/empty string", () => {
      expect(parseRangeQuery(assertType(null))).toEqual([]);
      expect(parseRangeQuery(undefined)).toEqual([]);
      expect(parseRangeQuery("")).toEqual([]);
    });

    test("should handle direct equality", () => {
      expect(parseRangeQuery("200")).toEqual([{ operator: "eq", value: 200 }]);
      expect(parseRangeQuery("active", "string")).toEqual([
        { operator: "eq", value: "active" },
      ]);
    });

    test("should handle operators", () => {
      const input = { gt: "100", lte: "500", invalid: "ignored" };
      expect(parseRangeQuery(input)).toEqual([
        { operator: "gt", value: 100 },
        { operator: "lte", value: 500 },
      ]);
    });

    test("should coerce values correctly", () => {
      expect(parseRangeQuery({ gt: "abc" }, "number")).toEqual([]);
      expect(parseRangeQuery({ eq: "123" }, "string")).toEqual([
        { operator: "eq", value: "123" },
      ]);
    });
  });

  describe("matchesRange", () => {
    test("should match number ranges", () => {
      const conditions = [
        { operator: "gt", value: 10 },
        { operator: "lt", value: 20 },
      ];
      expect(matchesRange(15, conditions)).toBe(true);
      expect(matchesRange(10, conditions)).toBe(false);
      expect(matchesRange(20, conditions)).toBe(false);
    });

    test("should match ne/eq", () => {
      expect(matchesRange(10, [{ operator: "ne", value: 10 }])).toBe(false);
      expect(matchesRange(10, [{ operator: "eq", value: 10 }])).toBe(true);
    });

    test("should match gte/lte", () => {
      expect(matchesRange(10, [{ operator: "gte", value: 10 }])).toBe(true);
      expect(matchesRange(9, [{ operator: "gte", value: 10 }])).toBe(false);
      expect(matchesRange(10, [{ operator: "lte", value: 10 }])).toBe(true);
      expect(matchesRange(11, [{ operator: "lte", value: 10 }])).toBe(false);
    });

    test("should return true for empty conditions", () => {
      expect(matchesRange(10, [])).toBe(true);
    });

    test("should return true for invalid input types if result agnostic (logic allows empty)", () => {
      // Current implementation returns true if conditions empty
      expect(matchesRange(assertType({}), [])).toBe(true);
    });

    test("should return false for invalid input type when check is needed", () => {
      expect(matchesRange(assertType({}), [{ operator: "eq", value: 1 }])).toBe(
        false,
      );
      expect(matchesRange(NaN, [{ operator: "eq", value: 1 }])).toBe(false);
    });
  });

  describe("matchesIp", () => {
    test("should delegate to checkIpInRanges", () => {
      matchesIp("1.2.3.4", "1.2.3.4");
      expect(checkIpInRanges).toHaveBeenCalledWith("1.2.3.4", ["1.2.3.4"]);
    });

    test("should handle empty filter", () => {
      expect(matchesIp("1.2.3.4", "")).toBe(true);
      expect(matchesIp("1.2.3.4", assertType(null))).toBe(true);
    });

    test("should return false if no client ip", () => {
      expect(matchesIp(assertType(null), "1.2.3.4")).toBe(false);
    });
  });

  describe("parseObjectFilter", () => {
    test("should lowercase string input", () => {
      expect(parseObjectFilter("FOO")).toBe("foo");
    });

    test("should flatten object to lowercase map", () => {
      expect(parseObjectFilter({ Foo: "Bar", Baz: "" })).toEqual({
        foo: "bar",
      });
    });

    test("should return null for invalid input", () => {
      expect(parseObjectFilter(assertType(null))).toBeNull();
      expect(parseObjectFilter(assertType(123))).toBeNull();
    });
  });

  describe("matchObject", () => {
    test("should match string vs object (search inside json)", () => {
      expect(matchObject({ foo: "bar" }, "bar")).toBe(true);
      expect(matchObject({ foo: "bar" }, "baz")).toBe(false);
    });

    test("should match string vs string", () => {
      expect(matchObject("somevalue", "val")).toBe(true);
    });

    test("should match object vs object", () => {
      expect(matchObject({ h1: "v1", h2: "v2" }, { h1: "v1" })).toBe(true);
      expect(matchObject({ h1: "v1" }, { h1: "v2" })).toBe(false);
      expect(matchObject({ h1: "v1" }, { h2: "v1" })).toBe(false);
    });

    test("should handle missing keys", () => {
      expect(matchObject({}, { h1: "v1" })).toBe(false);
    });

    test("should return true for empty filter", () => {
      expect(matchObject({}, null)).toBe(true);
    });
  });
});
