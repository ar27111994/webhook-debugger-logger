import { describe, test, expect } from "@jest/globals";
import {
  parseWebhookOptions,
  coerceRuntimeOptions,
} from "../src/utils/config.js";
import {
  BODY_PARSER_SIZE_LIMIT,
  DEFAULT_URL_COUNT,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
} from "../src/consts.js";

describe("Config Utils", () => {
  test("parseWebhookOptions should clamp maxPayloadSize to default maximum", () => {
    // Test capping at default
    const huge = BODY_PARSER_SIZE_LIMIT + 10000;
    const opts = parseWebhookOptions({ maxPayloadSize: huge });
    expect(opts.maxPayloadSize).toBe(BODY_PARSER_SIZE_LIMIT);

    // Test valid small size
    const small = 1024;
    const opts2 = parseWebhookOptions({ maxPayloadSize: small });
    expect(opts2.maxPayloadSize).toBe(small);

    // Test invalid input (non-number)
    // @ts-expect-error - Invalid input type for maxPayloadSize
    const opts3 = parseWebhookOptions({ maxPayloadSize: "invalid" });
    expect(opts3.maxPayloadSize).toBe(BODY_PARSER_SIZE_LIMIT);

    // Test negative input
    const opts4 = parseWebhookOptions({ maxPayloadSize: -100 });
    expect(opts4.maxPayloadSize).toBe(BODY_PARSER_SIZE_LIMIT);
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
    expect(result.maxPayloadSize).toBe(BODY_PARSER_SIZE_LIMIT);
  });
});
