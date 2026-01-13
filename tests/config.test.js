import { describe, test, expect } from "@jest/globals";
import {
  parseWebhookOptions,
  coerceRuntimeOptions,
  normalizeInput,
} from "../src/utils/config.js";
import {
  DEFAULT_PAYLOAD_LIMIT,
  MAX_ALLOWED_PAYLOAD_SIZE,
  DEFAULT_URL_COUNT,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
} from "../src/consts.js";

describe("Config Utils", () => {
  describe("normalizeInput", () => {
    test("should parse valid JSON string", () => {
      const input = '{"a": 1}';
      const result = normalizeInput(input);
      expect(result).toEqual({ a: 1 });
    });

    test("should handle invalid JSON string by returning fallback (default {})", () => {
      const input = "{ invalid";
      const result = normalizeInput(input);
      expect(result).toEqual({});
    });

    test("should return provided fallback for invalid JSON", () => {
      const input = "bad";
      const fallback = { safe: true };
      const result = normalizeInput(input, fallback);
      expect(result).toEqual(fallback);
    });

    test("should return non-string value as-is", () => {
      const input = { b: 2 };
      const result = normalizeInput(input);
      expect(result).toEqual(input);
    });

    test("should return fallback for null/undefined input", () => {
      expect(normalizeInput(null)).toEqual({});
      expect(normalizeInput(undefined, { f: 1 })).toEqual({ f: 1 });
    });
  });

  test("parseWebhookOptions should clamp maxPayloadSize to default maximum", () => {
    // Test capping at default
    const huge = MAX_ALLOWED_PAYLOAD_SIZE + 10000;
    const opts = parseWebhookOptions({ maxPayloadSize: huge });
    expect(opts.maxPayloadSize).toBe(MAX_ALLOWED_PAYLOAD_SIZE);

    // Test valid small size
    const small = 1024;
    const opts2 = parseWebhookOptions({ maxPayloadSize: small });
    expect(opts2.maxPayloadSize).toBe(small);

    // Test invalid input (non-number)
    // @ts-expect-error - Invalid input type for maxPayloadSize
    const opts3 = parseWebhookOptions({ maxPayloadSize: "invalid" });
    expect(opts3.maxPayloadSize).toBe(DEFAULT_PAYLOAD_LIMIT);

    // Test negative input
    const opts4 = parseWebhookOptions({ maxPayloadSize: -100 });
    expect(opts4.maxPayloadSize).toBe(DEFAULT_PAYLOAD_LIMIT);
  });
});

describe("coerceRuntimeOptions", () => {
  test("should return defaults for empty input", () => {
    const result = coerceRuntimeOptions({});
    expect(result.urlCount).toBe(DEFAULT_URL_COUNT);
    expect(result.retentionHours).toBe(DEFAULT_RETENTION_HOURS);
    expect(result.rateLimitPerMinute).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
    expect(result.authKey).toBe("");
  });

  test("should fail safe to defaults for invalid types", () => {
    const result = coerceRuntimeOptions({
      urlCount: "invalid",
      retentionHours: null,
      rateLimitPerMinute: -50,
    });
    expect(result.urlCount).toBe(DEFAULT_URL_COUNT);
    expect(result.retentionHours).toBe(DEFAULT_RETENTION_HOURS);
    expect(result.rateLimitPerMinute).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
  });

  test("should respect valid inputs", () => {
    const result = coerceRuntimeOptions({
      urlCount: 10,
      retentionHours: 48,
      rateLimitPerMinute: 120,
      authKey: " secret ",
    });
    expect(result.urlCount).toBe(10);
    expect(result.retentionHours).toBe(48);
    expect(result.rateLimitPerMinute).toBe(120);
    expect(result.authKey).toBe("secret"); // Trims whitespace
  });

  test("should cap maxPayloadSize correctly", () => {
    const result = coerceRuntimeOptions({ maxPayloadSize: 999999999 });
    expect(result.maxPayloadSize).toBe(MAX_ALLOWED_PAYLOAD_SIZE);
  });
});
