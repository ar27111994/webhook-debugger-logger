import { jest, describe, test, expect } from "@jest/globals";
import {
  getSafeResponseDelay,
  coerceRuntimeOptions,
  parseWebhookOptions,
} from "../../src/utils/config.js";
import {
  MAX_SAFE_RESPONSE_DELAY_MS,
  MAX_ALLOWED_PAYLOAD_SIZE,
  MAX_SAFE_URL_COUNT,
  MAX_SAFE_RETENTION_HOURS,
  MAX_SAFE_RATE_LIMIT_PER_MINUTE,
  MAX_SAFE_REPLAY_RETRIES,
  MAX_SAFE_REPLAY_TIMEOUT_MS,
  MAX_SAFE_FORWARD_RETRIES,
  DEFAULT_URL_COUNT,
  DEFAULT_PAYLOAD_LIMIT,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_RETENTION_HOURS,
} from "../../src/consts.js";

/**
 * @typedef {import('../../src/typedefs.js').SignatureProvider} SignatureProvider
 * @typedef {import('../../src/typedefs.js').AlertTrigger} AlertTrigger
 */

describe("Config Utils Coverage", () => {
  describe("getSafeResponseDelay", () => {
    test("should return 0 for invalid inputs", () => {
      expect(getSafeResponseDelay(-1)).toBe(0);
      expect(getSafeResponseDelay(NaN)).toBe(0);
      expect(getSafeResponseDelay(Infinity)).toBe(0); // Finite check
    });

    test("should cap delay at MAX_SAFE_RESPONSE_DELAY_MS", () => {
      const consoleSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const capped = getSafeResponseDelay(999999);
      expect(capped).toBe(MAX_SAFE_RESPONSE_DELAY_MS);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("exceeds safe max"),
      );
      consoleSpy.mockRestore();
    });

    test("should clamp maxForwardRetries", () => {
      // MAX_SAFE_FORWARD_RETRIES is imported from constants (10)
      const huge = 100;
      const result = coerceRuntimeOptions({ maxForwardRetries: huge });
      expect(result.maxForwardRetries).toBe(MAX_SAFE_FORWARD_RETRIES);
    });
  });

  describe("coerceRuntimeOptions", () => {
    test("should handle valid string inputs for numbers", () => {
      const opts = coerceRuntimeOptions({
        urlCount: "5",
        retentionHours: "48",
        rateLimitPerMinute: "100",
        maxPayloadSize: "2048",
        responseDelayMs: "500",
      });

      expect(opts.urlCount).toBe(5);
      expect(opts.retentionHours).toBe(48);
      expect(opts.rateLimitPerMinute).toBe(100);
      expect(opts.maxPayloadSize).toBe(2048);
      expect(opts.responseDelayMs).toBe(500);
    });

    test("should fallback to defaults for invalid inputs", () => {
      const opts = coerceRuntimeOptions({
        urlCount: "invalid",
        retentionHours: -5,
        rateLimitPerMinute: "NaN",
        maxPayloadSize: 0, // > 0 check
      });

      expect(opts.urlCount).toBe(DEFAULT_URL_COUNT); // Default
      expect(opts.retentionHours).toBe(DEFAULT_RETENTION_HOURS);
      expect(opts.rateLimitPerMinute).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
      expect(opts.maxPayloadSize).toBe(DEFAULT_PAYLOAD_LIMIT);
    });

    test("should cap maxPayloadSize", () => {
      const opts = coerceRuntimeOptions({
        maxPayloadSize: 999999999999, // Huge
      });
      expect(opts.maxPayloadSize).toBeLessThanOrEqual(MAX_ALLOWED_PAYLOAD_SIZE);
    });

    test("should clamp and log warnings for values exceeding safe maximums", () => {
      const consoleSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const opts = coerceRuntimeOptions({
        urlCount: 9999,
        retentionHours: 9999,
        rateLimitPerMinute: 9999,
        maxPayloadSize: 999999999999,
        replayMaxRetries: 9999,
        replayTimeoutMs: 999999,
        maxForwardRetries: 9999,
        responseDelayMs: 999999,
      });

      expect(opts.urlCount).toBe(MAX_SAFE_URL_COUNT);
      expect(opts.retentionHours).toBe(MAX_SAFE_RETENTION_HOURS);
      expect(opts.rateLimitPerMinute).toBe(MAX_SAFE_RATE_LIMIT_PER_MINUTE);
      expect(opts.maxPayloadSize).toBe(MAX_ALLOWED_PAYLOAD_SIZE);
      expect(opts.replayMaxRetries).toBe(MAX_SAFE_REPLAY_RETRIES);
      expect(opts.replayTimeoutMs).toBe(MAX_SAFE_REPLAY_TIMEOUT_MS);
      expect(opts.maxForwardRetries).toBe(MAX_SAFE_FORWARD_RETRIES);
      expect(opts.responseDelayMs).toBe(MAX_SAFE_RESPONSE_DELAY_MS);

      expect(consoleSpy).toHaveBeenCalledTimes(8);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("exceeds safe max"),
      );

      consoleSpy.mockRestore();
    });

    test("should trim authKey", () => {
      const opts = coerceRuntimeOptions({
        authKey: "  secret  ",
      });
      expect(opts.authKey).toBe("secret");
    });
  });

  describe("parseWebhookOptions", () => {
    test("should use defaults when options are undefined", () => {
      const result = parseWebhookOptions(undefined);
      expect(result.defaultResponseCode).toBe(200);
      expect(result.maskSensitiveData).toBe(true);
    });

    test("should pass through structured options (signature, alerts)", () => {
      const input = {
        signatureVerification: {
          provider: /** @type {SignatureProvider} */ ("stripe"),
          secret: "test",
        },
        alerts: { slack: { webhookUrl: "https://slack..." } },
        alertOn: /** @type {AlertTrigger[]} */ (["error"]),
      };
      const result = parseWebhookOptions(input);
      expect(result.signatureVerification).toEqual(input.signatureVerification);
      expect(result.alerts).toEqual(input.alerts);
      expect(result.alertOn).toEqual(input.alertOn);
    });
  });
});
