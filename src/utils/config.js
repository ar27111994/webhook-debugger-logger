/**
 * @file src/utils/config.js
 * @description Configuration parsing and normalization utilities.
 * Validates Actor input and applies sensible defaults with safety bounds.
 * @module utils/config
 */
import { APP_CONSTS } from "../consts/app.js";
import { HTTP_CONSTS } from "../consts/http.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { createChildLogger } from "./logger.js";

/**
 * @typedef {import("../typedefs.js").ActorInput} ActorInput
 * @typedef {import("../typedefs.js").WebhookConfig} WebhookConfig
 * @typedef {import("../typedefs.js").RuntimeOptions} RuntimeOptions
 */

/**
 * Parses and normalizes Actor input options with sensible defaults.
 *
 * @param {WebhookConfig} options - Raw input options from Actor.getInput()
 * @returns {WebhookConfig} Normalized configuration object
 */
export function parseWebhookOptions(options = {}) {
  return {
    allowedIps: options.allowedIps ?? [],
    defaultResponseCode:
      options.defaultResponseCode ?? HTTP_CONSTS.DEFAULT_RESPONSE_CODE,
    defaultResponseBody:
      options.defaultResponseBody ?? HTTP_CONSTS.DEFAULT_SUCCESS_BODY,
    defaultResponseHeaders: options.defaultResponseHeaders ?? {},
    forwardUrl: options.forwardUrl,
    forwardHeaders:
      options.forwardHeaders ?? APP_CONSTS.DEFAULT_FORWARD_HEADERS,
    jsonSchema: options.jsonSchema,
    customScript: options.customScript,
    maskSensitiveData:
      options.maskSensitiveData ?? APP_CONSTS.DEFAULT_MASK_SENSITIVE_DATA,
    redactBodyPaths: options.redactBodyPaths ?? [],
    enableJSONParsing:
      options.enableJSONParsing ?? APP_CONSTS.DEFAULT_ENABLE_JSON_PARSING,
    signatureVerification: options.signatureVerification,
    alerts: options.alerts,
    alertOn: options.alertOn,
    ...coerceRuntimeOptions(options),
  };
}

/**
 * Coerces and validates runtime options for hot-reloading.
 * @param {Partial<WebhookConfig>} input
 * @returns {RuntimeOptions}
 */
export function coerceRuntimeOptions(input) {
  const urlCountRaw = Number(input.urlCount);
  const urlCount =
    Number.isFinite(urlCountRaw) && urlCountRaw >= 1
      ? clampWithWarning(
          Math.floor(urlCountRaw),
          APP_CONSTS.MAX_SAFE_URL_COUNT,
          "urlCount",
        )
      : APP_CONSTS.DEFAULT_URL_COUNT;

  const retentionRaw = Number(input.retentionHours);
  const retentionHours =
    Number.isFinite(retentionRaw) && retentionRaw >= 1
      ? clampWithWarning(
          Math.floor(retentionRaw),
          APP_CONSTS.MAX_SAFE_RETENTION_HOURS,
          "retentionHours",
        )
      : APP_CONSTS.DEFAULT_RETENTION_HOURS;

  const rateLimitRaw = Number(input.rateLimitPerMinute);
  const rateLimitPerMinute =
    Number.isFinite(rateLimitRaw) && rateLimitRaw >= 1
      ? clampWithWarning(
          Math.floor(rateLimitRaw),
          APP_CONSTS.MAX_SAFE_RATE_LIMIT_PER_MINUTE,
          "rateLimitPerMinute",
        )
      : APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE;

  const authKey = typeof input.authKey === "string" ? input.authKey.trim() : "";

  const maxPayloadSizeRaw = Number(input.maxPayloadSize);
  const maxPayloadSize =
    Number.isFinite(maxPayloadSizeRaw) && maxPayloadSizeRaw > 0
      ? clampWithWarning(
          maxPayloadSizeRaw,
          APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE,
          "maxPayloadSize",
        )
      : APP_CONSTS.DEFAULT_PAYLOAD_LIMIT;

  const responseDelayMsRaw = Number(input.responseDelayMs);
  const responseDelayMs = getSafeResponseDelay(responseDelayMsRaw);

  const replayRetriesRaw = Number(input.replayMaxRetries);
  const replayMaxRetries =
    Number.isFinite(replayRetriesRaw) && replayRetriesRaw >= 0
      ? clampWithWarning(
          Math.floor(replayRetriesRaw),
          APP_CONSTS.MAX_SAFE_REPLAY_RETRIES,
          "replayMaxRetries",
        )
      : APP_CONSTS.DEFAULT_REPLAY_RETRIES;

  const replayTimeoutRaw = Number(input.replayTimeoutMs);
  const replayTimeoutMs =
    Number.isFinite(replayTimeoutRaw) &&
    replayTimeoutRaw >= APP_CONSTS.MIN_REPLAY_TIMEOUT_MS
      ? clampWithWarning(
          Math.floor(replayTimeoutRaw),
          APP_CONSTS.MAX_SAFE_REPLAY_TIMEOUT_MS,
          "replayTimeoutMs",
        )
      : APP_CONSTS.DEFAULT_REPLAY_TIMEOUT_MS;

  const forwardRetriesRaw = Number(input.maxForwardRetries);
  const maxForwardRetries =
    Number.isFinite(forwardRetriesRaw) && forwardRetriesRaw >= 0
      ? clampWithWarning(
          Math.floor(forwardRetriesRaw),
          APP_CONSTS.MAX_SAFE_FORWARD_RETRIES,
          "maxForwardRetries",
        )
      : APP_CONSTS.DEFAULT_FORWARD_RETRIES;

  const useFixedMemory = Boolean(input.useFixedMemory);
  const fixedMemoryRaw = Number(input.fixedMemoryMbytes);
  const fixedMemoryMbytes =
    Number.isFinite(fixedMemoryRaw) &&
    fixedMemoryRaw >= APP_CONSTS.MIN_FIXED_MEMORY_MBYTES
      ? clampWithWarning(
          fixedMemoryRaw,
          APP_CONSTS.MAX_SAFE_FIXED_MEMORY_MBYTES,
          "fixedMemoryMbytes",
        )
      : APP_CONSTS.DEFAULT_FIXED_MEMORY_MBYTES;

  return {
    urlCount,
    retentionHours,
    rateLimitPerMinute,
    authKey,
    maxPayloadSize,
    responseDelayMs,
    replayMaxRetries,
    replayTimeoutMs,
    maxForwardRetries,
    useFixedMemory,
    fixedMemoryMbytes,
  };
}

/**
 * Normalizes input value from Key-Value store.
 * Handles stringified JSON and safe fallback.
 * @param {any} value - The raw value from KV store (string or object)
 * @param {Partial<ActorInput>} [fallback] - Value to return if parsing fails or valid is null/undefined
 * @returns {ActorInput} Normalized object or fallback
 */
export function normalizeInput(value, fallback = {}) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value ?? fallback;
}

/**
 * Returns a safe response delay, clamped to the maximum allowed value.
 * Logs a warning if the requested delay exceeds the limit.
 * @param {number} delayMs
 * @returns {number}
 */
export function getSafeResponseDelay(delayMs = 0) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return 0;

  return clampWithWarning(
    delayMs,
    APP_CONSTS.MAX_SAFE_RESPONSE_DELAY_MS,
    "responseDelayMs",
  );
}

/**
 * Clamps a value to a maximum safe limit and logs a warning if exceeded.
 * @param {number} value - The input value to check
 * @param {number} max - The maximum allowed value
 * @param {string} name - The name of the configuration option (for logging)
 * @returns {number} The original value, or the max if exceeded
 */
function clampWithWarning(value, max, name) {
  if (value > max) {
    const log = createChildLogger({ component: LOG_COMPONENTS.CONFIG });
    log.warn({ name, value, max }, LOG_MESSAGES.CONFIG_VALUE_CLAMPED);
    return max;
  }
  return value;
}
