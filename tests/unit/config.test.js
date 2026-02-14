import { describe, test, expect } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { loggerMock, constsMock } from "../setup/helpers/shared-mocks.js";
import { APP_CONSTS } from "../../src/consts/app.js";
import { SIGNATURE_PROVIDERS } from "../../src/consts/security.js";

// Mock logger before importing config module
await setupCommonMocks({ logger: true, consts: true });

const {
  parseWebhookOptions,
  coerceRuntimeOptions,
  normalizeInput,
  getSafeResponseDelay,
} = await import("../../src/utils/config.js");

/**
 * @typedef {import('../../src/typedefs.js').SignatureProvider} SignatureProvider
 * @typedef {import('../../src/typedefs.js').AlertTrigger} AlertTrigger
 */

describe("Config Utils", () => {
  useMockCleanup();

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

    test("should handle falsy but valid values (0, false)", () => {
      expect(normalizeInput(0)).toEqual(0);
      expect(normalizeInput(false)).toEqual(false);
    });
  });

  describe("getSafeResponseDelay", () => {
    test("should return 0 for invalid or negative inputs", () => {
      expect(getSafeResponseDelay(-1)).toBe(0);
      expect(getSafeResponseDelay(NaN)).toBe(0);
      expect(getSafeResponseDelay(undefined)).toBe(0);
      expect(getSafeResponseDelay(Infinity)).toBe(0);
    });

    test("should return valid delay unchanged", () => {
      expect(getSafeResponseDelay(100)).toBe(100);
      expect(getSafeResponseDelay(constsMock.MAX_SAFE_RESPONSE_DELAY_MS)).toBe(
        10000,
      );
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    test("should cap huge delay and warn via structured logger", () => {
      const huge = constsMock.MAX_SAFE_RESPONSE_DELAY_MS + 5000;
      expect(getSafeResponseDelay(huge)).toBe(10000);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ name: "responseDelayMs" }),
        expect.stringContaining("exceeds safe max"),
      );
    });
  });

  describe("coerceRuntimeOptions", () => {
    test("should return defaults for empty/invalid input", () => {
      const result = coerceRuntimeOptions({});
      expect(result.urlCount).toBe(APP_CONSTS.DEFAULT_URL_COUNT);
      expect(result.retentionHours).toBe(APP_CONSTS.DEFAULT_RETENTION_HOURS);
      expect(result.rateLimitPerMinute).toBe(
        APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE,
      );
      expect(result.authKey).toBe("");
    });

    test("should handle string inputs and convert to numbers", () => {
      const result = coerceRuntimeOptions({
        urlCount: "10",
        retentionHours: "48",
        rateLimitPerMinute: "120",
        maxPayloadSize: "2048",
        responseDelayMs: "500",
      });
      expect(result.urlCount).toBe(10);
      expect(result.retentionHours).toBe(48);
      expect(result.rateLimitPerMinute).toBe(120);
      expect(result.maxPayloadSize).toBe(2048);
      expect(result.responseDelayMs).toBe(500);
    });

    test("should trim authKey", () => {
      const result = coerceRuntimeOptions({
        authKey: " secret ",
      });
      expect(result.authKey).toBe("secret");
    });

    test("should cap values exceeding safe maximums and log warnings", () => {
      const result = coerceRuntimeOptions({
        urlCount: 9999,
        retentionHours: 9999,
        rateLimitPerMinute: 9999,
        maxPayloadSize: 999999999,
        replayMaxRetries: 9999,
        replayTimeoutMs: 999999,
        maxForwardRetries: 9999,
        responseDelayMs: 999999,
      });

      expect(result.urlCount).toBe(APP_CONSTS.MAX_SAFE_URL_COUNT);
      expect(result.retentionHours).toBe(APP_CONSTS.MAX_SAFE_RETENTION_HOURS);
      expect(result.rateLimitPerMinute).toBe(
        APP_CONSTS.MAX_SAFE_RATE_LIMIT_PER_MINUTE,
      );
      expect(result.maxPayloadSize).toBe(APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE);
      expect(result.replayMaxRetries).toBe(APP_CONSTS.MAX_SAFE_REPLAY_RETRIES);
      expect(result.replayTimeoutMs).toBe(
        APP_CONSTS.MAX_SAFE_REPLAY_TIMEOUT_MS,
      );
      expect(result.maxForwardRetries).toBe(
        APP_CONSTS.MAX_SAFE_FORWARD_RETRIES,
      );
      expect(result.responseDelayMs).toBe(
        APP_CONSTS.MAX_SAFE_RESPONSE_DELAY_MS,
      );

      // Verify warnings logged for clamped values
      expect(loggerMock.warn).toHaveBeenCalledTimes(8);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.any(String) }),
        expect.stringContaining("exceeds safe max"),
      );
    });
  });

  describe("parseWebhookOptions", () => {
    test("should clamp maxPayloadSize to default maximum", () => {
      const huge = APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE + 10000;
      const opts = parseWebhookOptions({ maxPayloadSize: huge });
      expect(opts.maxPayloadSize).toBe(APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE);

      // @ts-expect-error - Invalid input type
      const opts3 = parseWebhookOptions({ maxPayloadSize: "invalid" });
      expect(opts3.maxPayloadSize).toBe(APP_CONSTS.DEFAULT_PAYLOAD_LIMIT);
    });

    test("should use defaults when options are undefined", () => {
      const result = parseWebhookOptions(undefined);
      expect(result.defaultResponseCode).toBe(constsMock.HTTP_STATUS.OK);
      expect(result.maskSensitiveData).toBe(true);
    });

    test("should pass through structured options (signature, alerts)", () => {
      const input = {
        signatureVerification: {
          provider: SIGNATURE_PROVIDERS.STRIPE,
          secret: "test",
        },
        alerts: { slack: { webhookUrl: "https://slack..." } },
        alertOn: ["error"],
      };
      const result = parseWebhookOptions(input);
      expect(result.signatureVerification).toEqual(input.signatureVerification);
      expect(result.alerts).toEqual(input.alerts);
      expect(result.alertOn).toEqual(input.alertOn);
    });
  });
});
