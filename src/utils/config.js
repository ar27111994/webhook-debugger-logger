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
 */

export const DEFAULT_MAX_PAYLOAD_SIZE = 10485760; // 10MB

/**
 * Parses and normalizes Actor input options with sensible defaults.
 *
 * @param {WebhookConfig} options - Raw input options from Actor.getInput()
 * @returns {WebhookConfig} Normalized configuration object
 */
export function parseWebhookOptions(options = {}) {
  const maxPayloadSizeRaw = Number(options.maxPayloadSize);
  const maxPayloadSize =
    Number.isFinite(maxPayloadSizeRaw) && maxPayloadSizeRaw > 0
      ? Math.min(maxPayloadSizeRaw, DEFAULT_MAX_PAYLOAD_SIZE)
      : DEFAULT_MAX_PAYLOAD_SIZE;

  return {
    authKey: options.authKey,
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
    maxPayloadSize,
    enableJSONParsing: options.enableJSONParsing ?? true,
    ...coerceRuntimeOptions(options),
  };
}

/**
 * Coerces and validates runtime options for hot-reloading.
 * @param {Record<string, any>} input
 * @returns {{ urlCount: number, retentionHours: number, rateLimitPerMinute: number, authKey: string }}
 */
export function coerceRuntimeOptions(input) {
  const urlCountRaw = Number(input.urlCount);
  const urlCount =
    Number.isFinite(urlCountRaw) && urlCountRaw >= 1
      ? Math.floor(urlCountRaw)
      : 3; // Default

  const retentionRaw = Number(input.retentionHours);
  const retentionHours =
    Number.isFinite(retentionRaw) && retentionRaw >= 1
      ? Math.floor(retentionRaw)
      : 24; // Default

  const rateLimitRaw = Number(input.rateLimitPerMinute);
  const rateLimitPerMinute =
    Number.isFinite(rateLimitRaw) && rateLimitRaw >= 1
      ? Math.floor(rateLimitRaw)
      : 60; // Default

  const authKey = typeof input.authKey === "string" ? input.authKey.trim() : "";

  return {
    urlCount,
    retentionHours,
    rateLimitPerMinute,
    authKey,
  };
}
