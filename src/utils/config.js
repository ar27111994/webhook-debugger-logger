import {
  DEFAULT_URL_COUNT,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_PAYLOAD_LIMIT,
  MAX_ALLOWED_PAYLOAD_SIZE,
} from "../consts.js";

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
    responseDelayMs: options.responseDelayMs ?? 0,
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
 * Coerces and validates runtime options for hot-reloading.
 * @param {Record<string, any>} input
 * @returns {{ urlCount: number, retentionHours: number, rateLimitPerMinute: number, authKey: string, maxPayloadSize: number }}
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

  return {
    urlCount,
    retentionHours,
    rateLimitPerMinute,
    authKey,
    maxPayloadSize,
  };
}
