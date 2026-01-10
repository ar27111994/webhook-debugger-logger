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
    rateLimitPerMinute: options.rateLimitPerMinute ?? 60,
    enableJSONParsing: options.enableJSONParsing ?? true,
  };
}
