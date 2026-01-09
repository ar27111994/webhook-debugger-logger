/**
 * @typedef {Object} WebhookItem
 * @property {string} id
 * @property {string} webhookId
 * @property {string} method
 * @property {Object} headers
 * @property {any} body
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
 * @property {string|Object} body
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
