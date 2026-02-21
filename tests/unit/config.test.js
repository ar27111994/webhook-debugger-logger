/**
 * @file tests/unit/config.test.js
 * @description Unit tests for configuration utilities.
 */

import { jest } from "@jest/globals";
import { APP_CONSTS } from "../../src/consts/app.js";
import { HTTP_CONSTS, HTTP_STATUS } from "../../src/consts/http.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { assertType } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/utils/config.js')} ConfigUtils
 * @typedef {import('../../src/typedefs.js').ActorInput} ActorInput
 */

// We import the module under test dynamically after setting up mocks
// to ensure it uses the mocked logger.

describe("Config Utils", () => {
  /** @type {ConfigUtils} */
  let configUtils;

  beforeAll(async () => {
    await setupCommonMocks({ logger: true });
    // Use jest.resetModules() to ensure clean import if previously imported
    jest.resetModules();
    configUtils = await import("../../src/utils/config.js");
  });

  beforeEach(() => {
    loggerMock.warn.mockClear();
  });

  describe("clampWithWarning (internal via exported functions)", () => {
    // Since clampWithWarning is internal, we test it through exported consumers
    // like coerceRuntimeOptions or getSafeResponseDelay
  });

  describe("getSafeResponseDelay", () => {
    it("should return 0 for invalid or negative inputs", () => {
      // eslint-disable-next-line no-magic-numbers
      expect(configUtils.getSafeResponseDelay(-10)).toBe(0);
      expect(configUtils.getSafeResponseDelay(NaN)).toBe(0);
      expect(configUtils.getSafeResponseDelay(NaN)).toBe(0);
      expect(configUtils.getSafeResponseDelay(assertType(null))).toBe(0);
    });

    it("should use default 0 when called with no arguments", () => {
      expect(configUtils.getSafeResponseDelay()).toBe(0);
    });

    it("should return value if within safe limits", () => {
      // eslint-disable-next-line no-magic-numbers
      const validDelay = APP_CONSTS.MAX_SAFE_RESPONSE_DELAY_MS / 2;
      expect(configUtils.getSafeResponseDelay(validDelay)).toBe(validDelay);
    });

    it("should clamp value to MAX_SAFE_RESPONSE_DELAY_MS and log warning if exceeded", () => {
      const excessiveDelay =
        APP_CONSTS.MAX_SAFE_RESPONSE_DELAY_MS + APP_CONSTS.MS_PER_SECOND;
      const safeDelay = configUtils.getSafeResponseDelay(excessiveDelay);

      expect(safeDelay).toBe(APP_CONSTS.MAX_SAFE_RESPONSE_DELAY_MS);

      // Verify warning log
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "responseDelayMs",
          value: excessiveDelay,
          max: APP_CONSTS.MAX_SAFE_RESPONSE_DELAY_MS,
        }),
        LOG_MESSAGES.CONFIG_VALUE_CLAMPED,
      );
    });
  });

  describe("normalizeInput", () => {
    it("should return fallback for null/undefined input", () => {
      const fallback = { foo: "bar" };
      expect(configUtils.normalizeInput(null, assertType(fallback))).toEqual(
        fallback,
      );
      expect(
        configUtils.normalizeInput(undefined, assertType(fallback)),
      ).toEqual(fallback);
    });

    it("should return default fallback if input is null/undefined", () => {
      // Coverage for verifying normalizeInput behavior
      expect(configUtils.normalizeInput(null)).toEqual({});
      expect(configUtils.normalizeInput(undefined)).toEqual({});
    });

    it("should return input as-is if it is already an object", () => {
      const input = { a: 1 };
      expect(configUtils.normalizeInput(input)).toEqual(input);
    });

    it("should parse valid JSON string", () => {
      const input = JSON.stringify({ key: "val" });
      expect(configUtils.normalizeInput(input)).toEqual({ key: "val" });
    });

    it("should return fallback if JSON parsing fails", () => {
      const invalidJson = "{ key: val }"; // invalid JSON
      /** @type {Partial<ActorInput>} */
      const fallback = { authKey: "fallback" };

      expect(configUtils.normalizeInput(invalidJson, fallback)).toEqual(
        fallback,
      );
    });
  });

  describe("coerceRuntimeOptions", () => {
    it("should use default values for missing or invalid inputs", () => {
      const options = configUtils.coerceRuntimeOptions({});

      expect(options.urlCount).toBe(APP_CONSTS.DEFAULT_URL_COUNT);
      expect(options.retentionHours).toBe(APP_CONSTS.DEFAULT_RETENTION_HOURS);
      expect(options.rateLimitPerMinute).toBe(
        APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE,
      );
      expect(options.maxPayloadSize).toBe(APP_CONSTS.DEFAULT_PAYLOAD_LIMIT);
      expect(options.authKey).toBe("");
    });

    it("should clamp excessive values and log warnings", () => {
      const URL_COUNT_EXCESSIVE = 10;
      const RETENTION_HOURS_EXCESSIVE = 5;
      const MAX_PAYLOAD_SIZE_EXCESSIVE = APP_CONSTS.BYTES_PER_KB;

      const excessiveInput = {
        urlCount: APP_CONSTS.MAX_SAFE_URL_COUNT + URL_COUNT_EXCESSIVE,
        retentionHours:
          APP_CONSTS.MAX_SAFE_RETENTION_HOURS + RETENTION_HOURS_EXCESSIVE,
        maxPayloadSize:
          APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE + MAX_PAYLOAD_SIZE_EXCESSIVE,
      };

      const options = configUtils.coerceRuntimeOptions(excessiveInput);

      expect(options.urlCount).toBe(APP_CONSTS.MAX_SAFE_URL_COUNT);
      expect(options.retentionHours).toBe(APP_CONSTS.MAX_SAFE_RETENTION_HOURS);
      expect(options.maxPayloadSize).toBe(APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE);

      // Should have logged multiple warnings
      expect(loggerMock.warn).toHaveBeenCalledTimes(1 + 1 + 1);
    });

    it("should handle undefined clamp limits gracefully", async () => {
      // Logic: if max is undefined, value > max is false, so it returns value.
      // We need to mock APP_CONSTS to force a limit to be undefined.
      jest.resetModules();

      // Mock consts with one limit missing
      jest.unstable_mockModule("../../src/consts/app.js", () => ({
        APP_CONSTS: {
          ...APP_CONSTS,
          MAX_SAFE_URL_COUNT: undefined,
        },
        ENV_VARS: {},
      }));

      // Re-import module under test to pick up the mock
      const { coerceRuntimeOptions } =
        await import("../../src/utils/config.js");

      const excessiveUrlCount = 999999;
      const input = { urlCount: excessiveUrlCount };
      const result = coerceRuntimeOptions(input);

      // Since max is undefined, check fails, returns input value unfiltered (or constrained by other logic if present)
      // In clampWithWarning(value, max), if max is undefined: 999999 > undefined is FALSE. Returns 999999.
      expect(result.urlCount).toBe(excessiveUrlCount);
    });

    it("should sanitize numeric inputs (floors, ensures strict positive)", () => {
      const input = {
        urlCount: "5.9", // should strictly be integer? Logic uses Math.floor
        retentionHours: "12.5",
      };
      const correctInput = {
        urlCount: 5,
        retentionHours: 12,
      };
      const options = configUtils.coerceRuntimeOptions(assertType(input));
      expect(options.urlCount).toBe(correctInput.urlCount);
      expect(options.retentionHours).toBe(correctInput.retentionHours);
    });

    it("should use default rate limit for invalid (low) values", () => {
      const input = { rateLimitPerMinute: 0 };
      const result = configUtils.coerceRuntimeOptions(input);
      expect(result.rateLimitPerMinute).toBe(
        APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE,
      );
    });

    it("should use default rate limit when input is invalid or negative", () => {
      const result = configUtils.coerceRuntimeOptions({
        rateLimitPerMinute: -5,
      });
      expect(result.rateLimitPerMinute).toBe(
        APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE,
      );

      const resultInvalid = configUtils.coerceRuntimeOptions(
        assertType({ rateLimitPerMinute: "invalid" }),
      );
      expect(resultInvalid.rateLimitPerMinute).toBe(
        APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE,
      );
    });

    it("should use provided rate limit if valid", () => {
      const validLimit = 100;
      const result = configUtils.coerceRuntimeOptions({
        rateLimitPerMinute: validLimit,
      });
      expect(result.rateLimitPerMinute).toBe(validLimit);
    });

    it("should trim authKey", () => {
      const correctAuthKey = "secret";
      const options = configUtils.coerceRuntimeOptions({
        authKey: `  ${correctAuthKey}  `,
      });
      expect(options.authKey).toBe(correctAuthKey);
    });

    it("should handle replay/forwarding options", () => {
      const replayMaxRetries = 5;
      const replayTimeoutMs = 5000;
      const maxForwardRetries = 2;
      const input = {
        replayMaxRetries,
        replayTimeoutMs,
        maxForwardRetries,
      };
      const options = configUtils.coerceRuntimeOptions(input);
      expect(options.replayMaxRetries).toBe(replayMaxRetries);
      expect(options.replayTimeoutMs).toBe(replayTimeoutMs);
      expect(options.maxForwardRetries).toBe(maxForwardRetries);
    });

    it("should clamp replay options", () => {
      const input = {
        replayMaxRetries: 100, // Max safe is 20
        replayTimeoutMs: 600000, // Max safe is 300000 (5 min)
        maxForwardRetries: 20, // Max safe is 10
      };
      const options = configUtils.coerceRuntimeOptions(input);
      expect(options.replayMaxRetries).toBe(APP_CONSTS.MAX_SAFE_REPLAY_RETRIES);
      expect(options.replayTimeoutMs).toBe(
        APP_CONSTS.MAX_SAFE_REPLAY_TIMEOUT_MS,
      );
      expect(options.maxForwardRetries).toBe(
        APP_CONSTS.MAX_SAFE_FORWARD_RETRIES,
      );
      expect(loggerMock.warn).toHaveBeenCalled();
    });

    it("should handle memory options", () => {
      const useFixedMemory = true;
      const fixedMemoryMbytes = 512;
      const input = {
        useFixedMemory,
        fixedMemoryMbytes,
      };
      const options = configUtils.coerceRuntimeOptions(input);
      expect(options.useFixedMemory).toBe(useFixedMemory);
      expect(options.fixedMemoryMbytes).toBe(fixedMemoryMbytes);
    });

    it("should clamp fixed memory options", () => {
      const input = {
        fixedMemoryMbytes: 40000, // Max safe is 32768
      };
      const options = configUtils.coerceRuntimeOptions(input);
      expect(options.fixedMemoryMbytes).toBe(
        APP_CONSTS.MAX_SAFE_FIXED_MEMORY_MBYTES,
      );
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ name: "fixedMemoryMbytes" }),
        expect.anything(),
      );
    });
  });

  describe("parseWebhookOptions", () => {
    it("should apply defaults for complex fields", () => {
      const result = configUtils.parseWebhookOptions({});
      expect(result.allowedIps).toEqual([]);
      expect(result.forwardHeaders).toEqual(APP_CONSTS.DEFAULT_FORWARD_HEADERS);
      expect(result.defaultResponseCode).toBe(
        HTTP_CONSTS.DEFAULT_RESPONSE_CODE,
      );
      expect(result.maskSensitiveData).toBe(
        APP_CONSTS.DEFAULT_MASK_SENSITIVE_DATA,
      );
    });

    it("should handle undefined input (default parameter)", () => {
      const result = configUtils.parseWebhookOptions();
      expect(result).toBeDefined();
      expect(result.allowedIps).toEqual([]);
    });

    it("should preserve provided valid values", () => {
      const input = {
        // eslint-disable-next-line sonarjs/no-hardcoded-ip
        allowedIps: ["1.2.3.4"],
        defaultResponseCode: HTTP_STATUS.CREATED,
        maskSensitiveData: false,
      };
      const result = configUtils.parseWebhookOptions(input);
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      expect(result.allowedIps).toEqual(["1.2.3.4"]);
      expect(result.defaultResponseCode).toBe(HTTP_STATUS.CREATED);
      expect(result.maskSensitiveData).toBe(false);
    });

    it("should include coerced runtime options", () => {
      const correctUrlCount = 50;
      const input = { urlCount: String(correctUrlCount) };
      const result = configUtils.parseWebhookOptions(assertType(input));
      expect(result.urlCount).toBe(correctUrlCount);
    });
  });
});
