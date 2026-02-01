import { describe, test, expect } from "@jest/globals";
import { secureCompare } from "../../src/utils/crypto.js";

describe("Crypto Utils", () => {
  describe("secureCompare", () => {
    test("should return true for identical strings", () => {
      expect(secureCompare("secret", "secret")).toBe(true);
      expect(secureCompare("", "")).toBe(true);
      expect(secureCompare("long-secret-key-123", "long-secret-key-123")).toBe(
        true,
      );
    });

    test("should return false for different strings of same length", () => {
      expect(secureCompare("secret", "public")).toBe(false);
      expect(secureCompare("12345", "12346")).toBe(false);
    });

    test("should return false for strings of different length", () => {
      expect(secureCompare("secret", "secret1")).toBe(false);
      expect(secureCompare("secret1", "secret")).toBe(false);
    });

    test("should return false for empty string mismatch", () => {
      expect(secureCompare("secret", "")).toBe(false);
      expect(secureCompare("", "secret")).toBe(false);
    });

    test("should handle unicode characters", () => {
      expect(secureCompare("👍", "👍")).toBe(true);
      expect(secureCompare("👍", "👎")).toBe(false);
    });
  });
});
