/**
 * @file tests/unit/security/sanitization.test.js
 * @description Security unit tests verifying input sanitization and XSS prevention.
 */
import { describe, test, expect } from "@jest/globals";
import {
  parseRangeQuery,
  parseObjectFilter,
  matchObject,
} from "../../../src/utils/filter_utils.js";
import { escapeHtml } from "../../../src/routes/utils.js";
import { assertType } from "../../setup/helpers/test-utils.js";

describe("Security & Sanitization", () => {
  describe("Input Sanitization (filter_utils)", () => {
    test("should ignore invalid operators in range queries (NoSQL Injection prevention)", () => {
      // Simulate malicious input attempting to use Mongo-style operators or similar
      const maliciousInput = {
        gt: "100",
        $where: "sleep(1000)", // Malicious operator
        __proto__: { isAdmin: true }, // Prototype pollution attempt
        unknownOp: "value",
      };

      const result = parseRangeQuery(maliciousInput, "number");

      // Should only contain the valid 'gt' operator
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ operator: "gt", value: 100 });
    });

    test("should handle prototype pollution attempts in parseObjectFilter", () => {
      const maliciousInput = JSON.parse(
        '{"__proto__": {"admin": true}, "validKey": "value"}',
      );

      const result = parseObjectFilter(maliciousInput);

      expect(result).toEqual({ validkey: "value" });
      // Ensure prototype is not modified and key is ignored
      expect(/** @type {any} */(result).admin).toBeUndefined();
      expect(
        /** @type {Object<string, any>} */(result).__proto__.admin,
      ).toBeUndefined();
    });

    test("should be robust against non-string inputs in matchObject", () => {
      // Ensure no crashes with nulls or non-strings
      expect(matchObject(null, { key: "val" })).toBe(false);
      expect(matchObject({ key: null }, { key: "val" })).toBe(false);
      expect(matchObject({ key: 123 }, { key: "123" })).toBe(true);
    });
  });

  describe("XSS Prevention (escapeHtml)", () => {
    test("should escape common XSS vectors", () => {
      const inputs = [
        {
          unsafe: "<script>alert(1)</script>",
          safe: "&lt;script&gt;alert(1)&lt;/script&gt;",
        },
        {
          unsafe: '"><img src=x onerror=alert(1)>',
          safe: "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;",
        },
        {
          unsafe: "'; DROP TABLE users; --",
          safe: "&#039;; DROP TABLE users; --",
        }, // SQLi-like string, mostly testing quoting
        { unsafe: "&", safe: "&amp;" },
      ];

      inputs.forEach(({ unsafe, safe }) => {
        expect(escapeHtml(unsafe)).toBe(safe);
      });
    });

    test("should handle empty or null inputs safely", () => {
      expect(escapeHtml(assertType(null))).toBe("");
      expect(escapeHtml(assertType(undefined))).toBe("");
      expect(escapeHtml("")).toBe("");
    });
  });
});
