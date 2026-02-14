/**
 * @file src/typedefs.js
 * @description Centralized JSDoc type definitions for the application.
 * Provides type safety and IDE support across all modules.
 * @module typedefs
 */

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
 * @property {string} [forwardUrl]
 * @property {boolean} [forwardHeaders]
 */

/**
 * @typedef {WebhookConfig} LoggerOptions
 * @typedef {WebhookConfig} ActorInput
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
 * @property {string} [bodyEncoding]
 * @property {string} contentType
 * @property {number} [size]
 * @property {number} statusCode
 * @property {string|Object} [responseBody]
 * @property {Object.<string, string>} [responseHeaders]
 * @property {number} processingTime
 * @property {string} [remoteIp]
 * @property {string} [userAgent]
 * @property {boolean} [signatureValid]
 * @property {string} [signatureProvider]
 * @property {string} [signatureError]
 * @property {string} [requestId]
 * @property {string} [requestUrl]
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
 * @property {Object.<string, any>} [response]
 * @property {boolean} [isHttpError]
 */

/**
 * @typedef {import('./consts/alerting.js').ALERT_TRIGGERS} AlertTriggerEnum
 * @typedef {import('./consts/alerting.js').ALERT_CHANNELS} AlertChannelEnum
 * @typedef {import('./consts/security.js').SIGNATURE_PROVIDERS} SignatureProviderEnum
 * @typedef {import('./consts/security.js').HASH_ALGORITHMS} HashAlgorithmEnum
 * @typedef {import('./consts/security.js').SIGNATURE_ENCODINGS} SignatureEncodingEnum
 */

/**
 * @typedef {AlertTriggerEnum[keyof AlertTriggerEnum]} AlertTrigger
 * @typedef {AlertChannelEnum[keyof AlertChannelEnum]} AlertChannel
 */

/**
 * @typedef {Object} AlertChannelConfig
 * @property {string} webhookUrl
 */

/**
 * @typedef {Object} AlertConfig
 * @property {AlertChannelConfig} [slack]
 * @property {AlertChannelConfig} [discord]
 * @property {AlertTrigger[]} [alertOn] - Trigger conditions
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
 * @typedef {SignatureProviderEnum[keyof SignatureProviderEnum]} SignatureProvider
 * @typedef {HashAlgorithmEnum[keyof HashAlgorithmEnum]} HashAlgorithm
 * @typedef {SignatureEncodingEnum[keyof SignatureEncodingEnum]} SignatureEncoding
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

/**
 * @typedef {import('express').Request['query'][string]} QueryValue
 */

/**
 * @typedef {WebhookEvent & { sourceOffset?: number, url?: string, signatureValidation?: SignatureResult }} LogEntry
 */

/**
 * @typedef {import('./consts/app.js').SORT_DIRECTIONS} SortDirectionEnum
 */

/**
 * @typedef {Object} SortRule
 * @property {string} field
 * @property {SortDirectionEnum[keyof SortDirectionEnum]} dir
 */

/**
 * @typedef {import('./utils/filter_utils.js').RangeCondition} RangeCondition
 */

/**
 * @typedef {Object} LogFilters
 * @property {string} [id]
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {string} [cursor] - Cursor for keyset pagination (timestamp:id encoded)
 * @property {SortRule[]} [sort]
 * @property {string} [search] - text search in ID or URL
 * @property {string} [requestUrl]
 * @property {string} [method]
 * @property {string} [webhookId]
 * @property {string} [requestId]
 * @property {string} [remoteIp]
 * @property {string} [userAgent]
 * @property {string} [contentType] - checked against headers['content-type']
 * @property {boolean|string} [signatureValid]
 * @property {string} [signatureProvider]
 * @property {string} [signatureError]
 * @property {number|string|RangeCondition[]} [statusCode]
 * @property {RangeCondition[]} [processingTime]
 * @property {RangeCondition[]} [size]
 * @property {RangeCondition[]} [timestamp]
 * @property {Object|string} [headers]
 * @property {Object|string} [query]
 * @property {Object|string} [body]
 * @property {Object|string} [responseHeaders]
 * @property {Object|string} [responseBody]
 */

/**
 * @typedef {import('express').Request} ExpressRequest
 */

/**
 * @typedef {Object} CustomRequestProps
 * @property {string} [requestId] - Unique ID for the request
 * @property {string} [rawBody] - Raw request body (for signature verification)
 * @property {number} [forcedStatus] - Forced HTTP status code (for testing/simulation)
 * @property {boolean} [isOffloaded] - Whether the payload was offloaded to KVS
 * @property {boolean} [_body] - Internal Express flag indicating body is processed
 * @property {SignatureResult} [ingestSignatureResult] - Pre-calculated signature result
 */

/**
 * @typedef {ExpressRequest & CustomRequestProps} CustomRequest
 */

/**
 * @typedef {Object} OffloadMarker
 * @property {string} type
 * @property {string} key
 * @property {string} url
 * @property {string} data
 */

/**
 * @typedef {import('express').RequestHandler & { updateOptions: function(Object): void }} LoggerMiddlewareFunction
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
 * @property {string[]} [redactBodyPaths]
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
 * @property {boolean} [useFixedMemory]
 * @property {number} [fixedMemoryMbytes]
 * @property {SignatureConfig} [signatureVerification]
 * @property {AlertConfig} [alerts]
 * @property {AlertTrigger[]} [alertOn]
 * @property {boolean} [testAndExit]
 */

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
 * @property {boolean} useFixedMemory
 * @property {number} fixedMemoryMbytes
 */

export {};
