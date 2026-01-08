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
 */

const DEFAULT_MAX_PAYLOAD_SIZE = 10485760; // 10MB

/**
 * Parses and normalizes Actor input options with sensible defaults.
 *
 * @param {WebhookConfig} options - Raw input options from Actor.getInput()
 * @returns {WebhookConfig} Normalized configuration object
 */
export function parseWebhookOptions(options = {}) {
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
    maxPayloadSize: options.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD_SIZE,
    rateLimitPerMinute: options.rateLimitPerMinute ?? 60,
  };
}
