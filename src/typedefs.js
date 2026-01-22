/**
 * @typedef {Object} WebhookItem
 * @property {string} id
 * @property {string} webhookId
 * @property {string} method
 * @property {Object} headers
 * @property {string|Object|Buffer} body
 * @property {string} timestamp
 * @property {number} statusCode
 */

/**
 * @typedef {Object} WebhookData
 * @property {string} expiresAt
 * @property {number} [responseDelayMs]
 * @property {number} [defaultResponseCode]
 * @property {string} [defaultResponseBody]
 * @property {Object.<string, string>} [defaultResponseHeaders]
 */

/**
 * @typedef {import('./utils/config.js').WebhookConfig} LoggerOptions
 */

/**
 * @typedef {Object} WebhookEvent
 * @property {string} id
 * @property {string} timestamp
 * @property {string} webhookId
 * @property {string} method
 * @property {Object.<string, string | string[] | undefined>} headers
 * @property {Object.<string, any>} query
 * @property {string|Object|Buffer} body
 * @property {string} contentType
 * @property {number | undefined} size
 * @property {number} statusCode
 * @property {string|Object} [responseBody]
 * @property {Object.<string, string>} [responseHeaders]
 * @property {number} processingTime
 * @property {string | undefined} remoteIp
 * @property {string | undefined} [userAgent]
 * @property {boolean} [signatureValid]
 * @property {string} [signatureProvider]
 * @property {string} [signatureError]
 * @property {string} [requestId]
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} isValid
 * @property {string} [error]
 */

/**
 * @typedef {ValidationResult & { statusCode?: number, remoteIp?: string, contentLength?: number, received?: number }} MiddlewareValidationResult
 */

/**
 * Result of SSRF URL validation.
 * @typedef {Object} SsrfValidationResult
 * @property {boolean} safe - Whether the URL is safe to access
 * @property {string} [error] - Error message if not safe
 * @property {string} [href] - Normalized URL href if safe
 * @property {string} [host] - Host header value if safe
 */

/**
 * @typedef {Object} CommonError
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [name]
 * @property {number} [statusCode]
 * @property {number} [status]
 * @property {string} [stack]
 * @property {string} [error]
 * @property {unknown} [details]
 * @property {Object} [response]
 */

/**
 * @typedef {("error" | "4xx" | "5xx" | "timeout" | "signature_invalid")} AlertTrigger
 * @typedef {("slack" | "discord")} AlertChannel
 */

/**
 * @typedef {Object} AlertChannelConfig
 * @property {string} webhookUrl
 */

/**
 * @typedef {Object} AlertConfig
 * @property {AlertChannelConfig} [slack]
 * @property {AlertChannelConfig} [discord]
 * @property {AlertTrigger[]} [alertOn] - Trigger conditions: "error", "4xx", "5xx", "timeout", "signature_invalid"
 */

/**
 * @typedef {Object} AlertContext
 * @property {string} webhookId
 * @property {string} method
 * @property {number} [statusCode]
 * @property {string} [error]
 * @property {boolean} [signatureValid]
 * @property {string} [signatureError]
 * @property {string} timestamp
 * @property {string} [sourceIp]
 */

/**
 * @typedef {"stripe" | "shopify" | "github" | "slack" | "custom"} SignatureProvider
 * @typedef {"sha256" | "sha1"} HashAlgorithm
 * @typedef {"hex" | "base64"} SignatureEncoding
 */

/**
 * @typedef {Object} SignatureConfig
 * @property {SignatureProvider} [provider]
 * @property {boolean} [enabled]
 * @property {string} [secret] - The signing secret
 * @property {string} [headerName] - Custom header name (for custom provider)
 * @property {HashAlgorithm} [algorithm] - Hash algorithm (for custom provider)
 * @property {string} [timestampKey] - Header name for custom provider timestamp check
 * @property {SignatureEncoding} [encoding] - Signature encoding (default: hex)
 * @property {string} [prefix]
 * @property {number} [tolerance] - Timestamp tolerance in seconds (default: 300)
 */

/**
 * @typedef {Object} SignatureResult
 * @property {boolean} valid
 * @property {string} [error]
 * @property {string} provider
 */

export {};
