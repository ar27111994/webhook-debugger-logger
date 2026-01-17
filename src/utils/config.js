import {
  DEFAULT_URL_COUNT,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_PAYLOAD_LIMIT,
  MAX_ALLOWED_PAYLOAD_SIZE,
  MAX_RESPONSE_DELAY_MS,
} from "../consts.js";

/**
 * @typedef {Object} SignatureVerificationConfig
 * @property {boolean} [enabled]
 * @property {string} [provider]
 * @property {string} [secret]
 * @property {string} [headerName]
 * @property {string} [algorithm]
 * @property {string} [encoding]
 * @property {string} [prefix]
 */

/**
 * @typedef {Object} AlertsConfig
 * @property {{ webhookUrl: string }} [slack]
 * @property {{ webhookUrl: string }} [discord]
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
 * @property {SignatureVerificationConfig} [signatureVerification]
 * @property {AlertsConfig} [alerts]
 * @property {string[]} [alertOn]
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
      ? Math.floor(urlCountRaw)
      : DEFAULT_URL_COUNT;

  const retentionRaw = Number(input.retentionHours);
  const retentionHours =
    Number.isFinite(retentionRaw) && retentionRaw >= 1
      ? Math.floor(retentionRaw)
      : DEFAULT_RETENTION_HOURS;

  const rateLimitRaw = Number(input.rateLimitPerMinute);
  const rateLimitPerMinute =
    Number.isFinite(rateLimitRaw) && rateLimitRaw >= 1
      ? Math.floor(rateLimitRaw)
      : DEFAULT_RATE_LIMIT_PER_MINUTE;

  const authKey = typeof input.authKey === "string" ? input.authKey.trim() : "";

  const maxPayloadSizeRaw = Number(input.maxPayloadSize);
  const maxPayloadSize =
    Number.isFinite(maxPayloadSizeRaw) && maxPayloadSizeRaw > 0
      ? Math.min(maxPayloadSizeRaw, MAX_ALLOWED_PAYLOAD_SIZE)
      : DEFAULT_PAYLOAD_LIMIT;

  const responseDelayMsRaw = Number(input.responseDelayMs);
  const responseDelayMs = getSafeResponseDelay(responseDelayMsRaw);

  return {
    urlCount,
    retentionHours,
    rateLimitPerMinute,
    authKey,
    maxPayloadSize,
    responseDelayMs,
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

  if (delayMs > MAX_RESPONSE_DELAY_MS) {
    console.warn(
      `[WARNING] Requested response delay ${delayMs}ms capped at ${MAX_RESPONSE_DELAY_MS}ms for stability.`,
    );
    return MAX_RESPONSE_DELAY_MS;
  }

  return delayMs;
}
