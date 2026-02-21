/**
 * @file tests/unit/filter_utils.test.js
 * @description Unit tests for filter utility functions.
 */

import { HTTP_METHODS, HTTP_STATUS } from "../../src/consts/http.js";
import {
  matchObject,
  parseRangeQuery,
  matchesRange,
  matchesIp,
  parseObjectFilter,
} from "../../src/utils/filter_utils.js";
import { assertType } from "../setup/helpers/test-utils.js";

describe("Filter Utils", () => {
  /* eslint-disable sonarjs/no-hardcoded-ip */
  const TEST_IP = "192.168.1.1";
  const TEST_RANGE_IP = "192.168.1.5";
  const TEST_RANGE_CIDR = "192.168.1.0/24";
  const TEST_OUT_OF_RANGE_IP = "10.0.0.1";
  const TEST_LOCALHOST = "127.0.0.1";
  const TEST_IPV6 = "::1";

  const TEST_VAL_10 = 10;
  const TEST_VAL_5_5 = 5.5;
  const TEST_VAL_5 = 5;

  describe("parseRangeQuery", () => {
    it("should parse valid range operators", () => {
      expect(parseRangeQuery({ gt: "10" })).toEqual([
        { operator: "gt", value: TEST_VAL_10 },
      ]);
      expect(parseRangeQuery({ lte: "5.5" })).toEqual([
        { operator: "lte", value: TEST_VAL_5_5 },
      ]);
    });

    it("should handle simple scalar values (equality shorthand)", () => {
      expect(parseRangeQuery("10")).toEqual([
        { operator: "eq", value: TEST_VAL_10 },
      ]);
      expect(parseRangeQuery(TEST_VAL_10)).toEqual([
        { operator: "eq", value: TEST_VAL_10 },
      ]);
    });

    it("should return null (empty array actually) for invalid formats", () => {
      expect(parseRangeQuery("invalid")).toEqual([]); // parses as NaN -> null -> empty array
      expect(parseRangeQuery({ gt: "nan" })).toEqual([]);
      expect(parseRangeQuery({ gt: "nan" })).toEqual([]);
      expect(parseRangeQuery(assertType(null))).toEqual([]);
    });

    it("should ignore potentially dangerous operators if implemented", () => {
      // Depending on implementation, ensure strict operator whitelist
      // Assuming implementation only supports gt, gte, lt, lte, eq, neq
      expect(parseRangeQuery({ $where: "1" })).toEqual([]);
    });

    it('should handle type="string" explicitly', () => {
      expect(parseRangeQuery("val", "string")).toEqual([
        { operator: "eq", value: "val" },
      ]);
      expect(parseRangeQuery({ ne: 123 }, "string")).toEqual([
        { operator: "ne", value: "123" },
      ]);
    });
  });

  describe("matchesRange", () => {
    it("should match correctly based on operator", () => {
      expect(
        matchesRange(TEST_VAL_10, [{ operator: "gt", value: TEST_VAL_5 }]),
      ).toBe(true);
      expect(
        matchesRange(TEST_VAL_10, [{ operator: "lt", value: TEST_VAL_5 }]),
      ).toBe(false);
      expect(
        matchesRange(TEST_VAL_10, [{ operator: "eq", value: TEST_VAL_10 }]),
      ).toBe(true);

      // Branch coverage for other operators
      expect(
        matchesRange(TEST_VAL_10, [{ operator: "gte", value: TEST_VAL_10 }]),
      ).toBe(true);
      expect(matchesRange(TEST_VAL_10, [{ operator: "gte", value: 11 }])).toBe(
        false,
      );
      expect(
        matchesRange(TEST_VAL_10, [{ operator: "lte", value: TEST_VAL_10 }]),
      ).toBe(true);
      expect(matchesRange(TEST_VAL_10, [{ operator: "lte", value: 5 }])).toBe(
        false,
      );
      expect(matchesRange(TEST_VAL_10, [{ operator: "ne", value: 5 }])).toBe(
        true,
      );
      expect(matchesRange(TEST_VAL_10, [{ operator: "ne", value: 10 }])).toBe(
        false,
      );

      // Unknown operator
      expect(
        matchesRange(TEST_VAL_10, [{ operator: "unknown", value: 10 }]),
      ).toBe(true);
    });

    it("should return false for invalid value types", () => {
      expect(
        matchesRange(assertType(null), [{ operator: "eq", value: 1 }]),
      ).toBe(false); // value check
      expect(matchesRange(NaN, [{ operator: "eq", value: 1 }])).toBe(false);
    });

    it("should handle lexicographical comparison for strings", () => {
      expect(matchesRange("b", [{ operator: "gt", value: "a" }])).toBe(true);
    });

    it("should return true for empty or null conditions", () => {
      const value = 10;
      expect(matchesRange(value, [])).toBe(true);
      expect(matchesRange(value, assertType(null))).toBe(true);
    });
  });

  describe("matchesIp", () => {
    it("should match exact IP", () => {
      expect(matchesIp(TEST_IP, TEST_IP)).toBe(true);
    });

    it("should match CIDR ranges", () => {
      expect(matchesIp(TEST_RANGE_IP, TEST_RANGE_CIDR)).toBe(true);
      expect(matchesIp(TEST_OUT_OF_RANGE_IP, TEST_RANGE_CIDR)).toBe(false);
    });

    it("should return true for empty filter (default allow)", () => {
      expect(matchesIp(TEST_LOCALHOST, "")).toBe(true);
    });

    it("should handle IPv6 CIDR if supported", () => {
      // Assuming implementation supports standard CIDR libs or logic
      // Basic test
      expect(matchesIp(TEST_IPV6, TEST_IPV6)).toBe(true);
    });

    it("should return false if clientIp is missing", () => {
      expect(matchesIp(assertType(null), TEST_IP)).toBe(false);
    });
  });

  describe("parseObjectFilter", () => {
    it("should return null for empty/invalid inputs", () => {
      expect(parseObjectFilter(assertType(null))).toBeNull();
      expect(parseObjectFilter([])).toBeNull(); // Arrays treated as invalid for object filter
    });

    it("should return lowercase string for string input", () => {
      expect(parseObjectFilter("FILTER")).toBe("filter");
    });

    it("should parse object into lowercase string map", () => {
      const input = { "User-Agent": "Mozilla", Accept: "" };
      const result = parseObjectFilter(input);
      expect(result).toEqual({ "user-agent": "mozilla" }); // Empty value filtered out
    });
  });

  describe("matchObject", () => {
    const item = {
      status: HTTP_STATUS.OK,
      method: HTTP_METHODS.POST,
      meta: { id: 123 },
      tags: ["api", "v1"],
    };

    it("should return true for matching filters", () => {
      expect(matchObject(item, assertType({ status: HTTP_STATUS.OK }))).toBe(
        true,
      );

      // Verify partial property match
      expect(matchObject(item, assertType({ tags: "api" }))).toBe(true); // toString check includes 'api'
    });

    it("should handle string filter", () => {
      expect(matchObject(item, "POST")).toBe(true);
      expect(matchObject(item, "GET")).toBe(false);
      // String target vs string filter
      expect(matchObject("my-string", "ring")).toBe(true);
    });

    it("should handle non-string filter values (strict equality)", () => {
      expect(matchObject(item, assertType({ status: HTTP_STATUS.OK }))).toBe(
        true,
      );
      expect(
        matchObject(item, assertType({ status: HTTP_STATUS.CREATED })),
      ).toBe(false);
    });

    it("should return true if filter is empty", () => {
      expect(matchObject(item, null)).toBe(true);
    });

    it("should handle null/undefined target object", () => {
      // Coverage for line 146: const target = itemObj || {};
      expect(matchObject(null, assertType({ status: HTTP_STATUS.OK }))).toBe(
        false,
      );
      expect(
        matchObject(undefined, assertType({ status: HTTP_STATUS.OK })),
      ).toBe(false);
      expect(matchObject(0, assertType({ status: HTTP_STATUS.OK }))).toBe(
        false,
      );
      expect(matchObject(false, assertType({ status: HTTP_STATUS.OK }))).toBe(
        false,
      );
      expect(matchObject("", assertType({ status: HTTP_STATUS.OK }))).toBe(
        false,
      );
    });

    it("should return false for non-matching filters", () => {
      expect(
        matchObject(item, assertType({ status: HTTP_STATUS.NOT_FOUND })),
      ).toBe(false);
    });

    it("should safely handle prototype pollution attempts in filter keys", () => {
      // Ensure we don't accidentally match up the prototype chain if logic uses "in" operator loosely
      const protoObject = {};

      // Verify safe handling of prototype checks (e.g. toString)
      expect(typeof matchObject(protoObject, { toString: "function" })).toBe(
        "boolean",
      );

      // Verify resilience against prototype pollution attempts
      expect(
        matchObject(item, assertType({ "__proto__.polluted": true })),
      ).toBe(false);
    });

    it("should handle deep nesting safely", () => {
      const deepItem = { a: { b: { c: 1 } } };
      // Assuming dot notation support 'a.b.c'
      expect(matchObject(deepItem, assertType({ "a.b.c": 1 }))).toBe(true);
      expect(matchObject(deepItem, assertType({ "a.b.d": 1 }))).toBe(false);
    });
  });
});
