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
 */

export {};

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
 * @property {number} [statusCode]
 * @property {number} [status]
 * @property {string} [stack]
 * @property {string} [error]
 * @property {unknown} [details]
 * @property {Object} [response]
 */
