/**
 * Parses and normalizes Actor input options with sensible defaults.
 *
 * @param {Object} options - Raw input options from Actor.getInput()
 * @returns {Object} Normalized configuration object
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
    maxPayloadSize: options.maxPayloadSize ?? 10485760, // 10MB default
    rateLimitPerMinute: options.rateLimitPerMinute ?? 60,
  };
}
