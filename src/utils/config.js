/**
 * @file src/utils/config.js
 * @description Configuration parsing and normalization utilities.
 * Validates Actor input and applies sensible defaults with safety bounds.
 */
import {
  DEFAULT_URL_COUNT,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_REPLAY_RETRIES,
  DEFAULT_REPLAY_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_PAYLOAD_LIMIT,
  MAX_ALLOWED_PAYLOAD_SIZE,
  MAX_SAFE_RESPONSE_DELAY_MS,
  MAX_SAFE_REPLAY_RETRIES,
  MAX_SAFE_RATE_LIMIT_PER_MINUTE,
  MAX_SAFE_RETENTION_HOURS,
  MAX_SAFE_URL_COUNT,
  MAX_SAFE_REPLAY_TIMEOUT_MS,
  DEFAULT_FORWARD_RETRIES,
  MAX_SAFE_FORWARD_RETRIES,
} from "../consts.js";
import { createChildLogger } from "./logger.js";

/**
 * @typedef {import("../typedefs.js").SignatureConfig} SignatureConfig
 * @typedef {import("../typedefs.js").AlertConfig} AlertConfig
 * @typedef {import("../typedefs.js").AlertTrigger} AlertTrigger
 */

/**
 * @typedef {Object} WebhookConfig
 * @property {string} [authKey]
 * @property {string[]} [allowedIps]
 * @property {number} [defaultResponseCode]
 * @property {string} [defaultResponseBody]
 * @property {Object.<string, string>} [defaultResponseHeaders]
 * @property {number} [responseDelayMs]
 * @property {string} [forwardUrl]
 * @property {boolean} [forwardHeaders]
 * @property {Object} [jsonSchema]
 * @property {string} [customScript]
 * @property {boolean} [maskSensitiveData]
 * @property {number} [maxPayloadSize]
 * @property {number} [rateLimitPerMinute]
 * @property {boolean} [enableJSONParsing]
 * @property {number} [urlCount]
 * @property {number} [retentionHours]
 * @property {number} [replayMaxRetries]
 * @property {number} [replayTimeoutMs]
 * @property {number} [maxForwardRetries]
 * @property {SignatureConfig} [signatureVerification]
 * @property {AlertConfig} [alerts]
 * @property {AlertTrigger[]} [alertOn]
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
    defaultResponseCode: options.defaultResponseCode ?? 200,
    defaultResponseBody: options.defaultResponseBody ?? "OK",
    defaultResponseHeaders: options.defaultResponseHeaders ?? {},
    forwardUrl: options.forwardUrl,
    forwardHeaders: options.forwardHeaders ?? true,
    jsonSchema: options.jsonSchema,
    customScript: options.customScript,
    maskSensitiveData: options.maskSensitiveData ?? true, // Default to true
    enableJSONParsing: options.enableJSONParsing ?? true,
    signatureVerification: options.signatureVerification,
    alerts: options.alerts,
    alertOn: options.alertOn,
    ...coerceRuntimeOptions(options),
  };
}

/**
 * @typedef {Object} RuntimeOptions
 * @property {number} urlCount
 * @property {number} retentionHours
 * @property {number} rateLimitPerMinute
 * @property {string} authKey
 * @property {number} maxPayloadSize
 * @property {number} responseDelayMs
 * @property {number} replayMaxRetries
 * @property {number} replayTimeoutMs
 * @property {number} maxForwardRetries
 */

/**
 * Coerces and validates runtime options for hot-reloading.
 * @param {Record<string, any>} input
 * @returns {RuntimeOptions}
 */
export function coerceRuntimeOptions(input) {
  const urlCountRaw = Number(input.urlCount);
  const urlCount =
    Number.isFinite(urlCountRaw) && urlCountRaw >= 1
      ? clampWithWarning(
          Math.floor(urlCountRaw),
          MAX_SAFE_URL_COUNT,
          "urlCount",
        )
      : DEFAULT_URL_COUNT;

  const retentionRaw = Number(input.retentionHours);
  const retentionHours =
    Number.isFinite(retentionRaw) && retentionRaw >= 1
      ? clampWithWarning(
          Math.floor(retentionRaw),
          MAX_SAFE_RETENTION_HOURS,
          "retentionHours",
        )
      : DEFAULT_RETENTION_HOURS;

  const rateLimitRaw = Number(input.rateLimitPerMinute);
  const rateLimitPerMinute =
    Number.isFinite(rateLimitRaw) && rateLimitRaw >= 1
      ? clampWithWarning(
          Math.floor(rateLimitRaw),
          MAX_SAFE_RATE_LIMIT_PER_MINUTE,
          "rateLimitPerMinute",
        )
      : DEFAULT_RATE_LIMIT_PER_MINUTE;

  const authKey = typeof input.authKey === "string" ? input.authKey.trim() : "";

  const maxPayloadSizeRaw = Number(input.maxPayloadSize);
  const maxPayloadSize =
    Number.isFinite(maxPayloadSizeRaw) && maxPayloadSizeRaw > 0
      ? clampWithWarning(
          maxPayloadSizeRaw,
          MAX_ALLOWED_PAYLOAD_SIZE,
          "maxPayloadSize",
        )
      : DEFAULT_PAYLOAD_LIMIT;

  const responseDelayMsRaw = Number(input.responseDelayMs);
  const responseDelayMs = getSafeResponseDelay(responseDelayMsRaw);

  const replayRetriesRaw = Number(input.replayMaxRetries);
  const replayMaxRetries =
    Number.isFinite(replayRetriesRaw) && replayRetriesRaw >= 0
      ? clampWithWarning(
          Math.floor(replayRetriesRaw),
          MAX_SAFE_REPLAY_RETRIES,
          "replayMaxRetries",
        )
      : DEFAULT_REPLAY_RETRIES;

  const replayTimeoutRaw = Number(input.replayTimeoutMs);
  const replayTimeoutMs =
    Number.isFinite(replayTimeoutRaw) && replayTimeoutRaw >= 1000
      ? clampWithWarning(
          Math.floor(replayTimeoutRaw),
          MAX_SAFE_REPLAY_TIMEOUT_MS,
          "replayTimeoutMs",
        )
      : DEFAULT_REPLAY_TIMEOUT_MS;

  const forwardRetriesRaw = Number(input.maxForwardRetries);
  const maxForwardRetries =
    Number.isFinite(forwardRetriesRaw) && forwardRetriesRaw >= 0
      ? clampWithWarning(
          Math.floor(forwardRetriesRaw),
          MAX_SAFE_FORWARD_RETRIES,
          "maxForwardRetries",
        )
      : DEFAULT_FORWARD_RETRIES;

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
  };
}

/**
 * Normalizes input value from Key-Value store.
 * Handles stringified JSON and safe fallback.
 * @param {any} value - The raw value from KV store (string or object)
 * @param {any} [fallback] - Value to return if parsing fails or valid is null/undefined
 * @returns {any} Normalized object or fallback
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
    MAX_SAFE_RESPONSE_DELAY_MS,
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
    const log = createChildLogger({ component: "Config" });
    log.warn({ name, value, max }, "Value exceeds safe max, clamping to limit");
    return max;
  }
  return value;
}
