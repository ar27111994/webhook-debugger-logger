import { describe, test, expect } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { loggerMock, constsMock } from "../setup/helpers/shared-mocks.js";
import { assertType } from "../setup/helpers/test-utils.js";
import { APP_CONSTS } from "../../src/consts/app.js";
import { SIGNATURE_PROVIDERS } from "../../src/consts/security.js";
import { ALERT_CHANNELS, ALERT_TRIGGERS } from "../../src/consts/alerting.js";

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
 * @typedef {import('../../src/typedefs.js').WebhookConfig} WebhookConfig
 */

const SAFE_DELAY = 100;
const EXPECTED_MAX_DELAY = constsMock.MAX_SAFE_RESPONSE_DELAY_MS;
const HUGE_DELAY_OFFSET = 5000;
const TEST_URL_COUNT = 10;
const TEST_RETENTION_HOURS = 48;
const TEST_RATE_LIMIT = 120;
const TEST_PAYLOAD_SIZE = 2048;
const TEST_RESPONSE_DELAY = 500;
const HUGE_INPUT_VALUE = 999999;
const PAYLOAD_CLAMP_OFFSET = 10000;

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
      /** @type {WebhookConfig} */
      const fallback = assertType({ safe: true });
      const result = normalizeInput(input, fallback);
      expect(result).toEqual(fallback);
    });

    test("should return non-string value as-is", () => {
      const input = { b: 2 };
      const result = normalizeInput(input);
      expect(result).toEqual(input);
    });

    test("should return fallback for null/undefined input", () => {
      expect(normalizeInput(assertType(null))).toEqual({});
      expect(normalizeInput(undefined, assertType({ f: 1 }))).toEqual({
        f: 1,
      });
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
      expect(getSafeResponseDelay(SAFE_DELAY)).toBe(SAFE_DELAY);
      expect(getSafeResponseDelay(EXPECTED_MAX_DELAY)).toBe(EXPECTED_MAX_DELAY);
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    test("should cap huge delay and warn via structured logger", () => {
      const huge = EXPECTED_MAX_DELAY + HUGE_DELAY_OFFSET;
      expect(getSafeResponseDelay(huge)).toBe(EXPECTED_MAX_DELAY);
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
      const result = coerceRuntimeOptions(
        assertType({
          urlCount: String(TEST_URL_COUNT),
          retentionHours: String(TEST_RETENTION_HOURS),
          rateLimitPerMinute: String(TEST_RATE_LIMIT),
          maxPayloadSize: String(TEST_PAYLOAD_SIZE),
          responseDelayMs: String(TEST_RESPONSE_DELAY),
        }),
      );
      expect(result.urlCount).toBe(TEST_URL_COUNT);
      expect(result.retentionHours).toBe(TEST_RETENTION_HOURS);
      expect(result.rateLimitPerMinute).toBe(TEST_RATE_LIMIT);
      expect(result.maxPayloadSize).toBe(TEST_PAYLOAD_SIZE);
      expect(result.responseDelayMs).toBe(TEST_RESPONSE_DELAY);
    });

    test("should trim authKey", () => {
      const secret = "secret";
      const result = coerceRuntimeOptions({
        authKey: ` ${secret} `,
      });
      expect(result.authKey).toBe(secret);
    });

    test("should cap values exceeding safe maximums and log warnings", () => {
      const HUGE_VAL = 999999;
      const input = {
        urlCount: HUGE_VAL,
        retentionHours: HUGE_VAL,
        rateLimitPerMinute: HUGE_VAL,
        maxPayloadSize: HUGE_VAL,
        replayMaxRetries: HUGE_VAL,
        replayTimeoutMs: HUGE_VAL,
        maxForwardRetries: HUGE_INPUT_VALUE,
        responseDelayMs: HUGE_INPUT_VALUE,
        fixedMemoryMbytes: HUGE_INPUT_VALUE,
      };

      const result = coerceRuntimeOptions(input);

      expect(result.urlCount).toBe(APP_CONSTS.MAX_SAFE_URL_COUNT);
      expect(result.retentionHours).toBe(APP_CONSTS.MAX_SAFE_RETENTION_HOURS);
      expect(result.rateLimitPerMinute).toBe(
        APP_CONSTS.MAX_SAFE_RATE_LIMIT_PER_MINUTE,
      );
      const CAP_VAL = 999999;
      expect(result.maxPayloadSize).toBe(CAP_VAL);
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
      expect(result.fixedMemoryMbytes).toBe(
        APP_CONSTS.MAX_SAFE_FIXED_MEMORY_MBYTES,
      );

      // Verify warnings logged for clamped values
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.any(String) }),
        expect.stringContaining("exceeds safe max"),
      );
    });
  });

  describe("parseWebhookOptions", () => {
    test("should clamp maxPayloadSize to default maximum", () => {
      const huge = APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE + PAYLOAD_CLAMP_OFFSET;
      const opts = parseWebhookOptions({ maxPayloadSize: huge });
      expect(opts.maxPayloadSize).toBe(APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE);

      const invalidInput = { maxPayloadSize: "invalid" };
      const opts3 = parseWebhookOptions(assertType(invalidInput));
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
        alerts: { [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://slack..." } },
        alertOn: [ALERT_TRIGGERS.ERROR],
      };
      const result = parseWebhookOptions(input);
      expect(result.signatureVerification).toEqual(input.signatureVerification);
      expect(result.alerts).toEqual(input.alerts);
      expect(result.alertOn).toEqual(input.alertOn);
    });
  });
});
