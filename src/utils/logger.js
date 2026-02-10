/**
 * @file src/utils/logger.js
 * @description Structured logging utility using Pino.
 * Provides consistent JSON log output with request ID correlation and sensitive data redaction.
 * @module utils/logger
 */
import pino from "pino";
import { APP_CONSTS, ENV_VARS } from "../consts/app.js";
import { LOG_CONSTS } from "../consts/logging.js";

/**
 * @typedef {import('../typedefs.js').CommonError} CommonError
 */

/**
 * @typedef {Object} SerializedError
 * @property {string} [type]
 * @property {string} message
 * @property {string} [stack]
 * @property {string} [code]
 */

/**
 * Log levels for convenience.
 */
export const LogLevel = Object.freeze({
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
});

/**
 * Redaction paths for sensitive data in logs.
 * Uses Pino's redaction feature to mask sensitive values.
 */
const REDACT_PATHS = LOG_CONSTS.REDACT_PATHS;

/**
 * Log level from environment or default to 'info'.
 * Supports: trace, debug, info, warn, error, fatal
 */
const LOG_LEVEL = process.env[ENV_VARS.LOG_LEVEL] || LogLevel.INFO;

/**
 * Whether to format logs for human readability (development).
 * Set PRETTY_LOGS=true for colorized output.
 */
const PRETTY_LOGS = process.env[ENV_VARS.PRETTY_LOGS] === "true";

/**
 * Creates the base Pino logger configuration.
 * @returns {pino.LoggerOptions}
 */
function createLoggerConfig() {
  /** @type {pino.LoggerOptions} */
  const config = {
    level: LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: LOG_CONSTS.CENSOR_MARKER,
    },
    formatters: {
      level: (label) => ({ level: label }),
      bindings: () => ({}), // Remove pid and hostname for cleaner logs
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: APP_CONSTS.SERVICE_NAME,
    },
  };

  return config;
}

/**
 * The main application logger instance.
 * Use this for general application logging.
 *
 * @example
 * import { logger } from './utils/logger.js';
 * logger.info({ webhookId: 'wh_123' }, 'Webhook received');
 * logger.error({ err, requestId }, 'Processing failed');
 */
const transport = PRETTY_LOGS
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    })
  : undefined;

export const logger = transport
  ? pino(createLoggerConfig(), transport)
  : pino(createLoggerConfig());

/**
 * Creates a child logger with additional context.
 * Use for component-specific logging.
 *
 * @param {Record<string, any>} bindings - Context to include in all logs
 * @returns {pino.Logger}
 *
 * @example
 * const moduleLogger = createChildLogger({ component: 'ForwardingService' });
 * moduleLogger.info({ url }, 'Forwarding request');
 */
export function createChildLogger(bindings) {
  return logger.child(bindings);
}

/**
 * Creates a request-scoped logger with requestId bound.
 *
 * @param {string} requestId - The request correlation ID
 * @returns {pino.Logger}
 */
export function createRequestLogger(requestId) {
  return logger.child({ requestId });
}

/**
 * Utility to safely serialize errors for structured logging.
 *
 * @param {Error | unknown} err - The error to serialize
 * @returns {SerializedError}
 */
export function serializeError(err) {
  if (err instanceof Error) {
    /** @type {SerializedError} */
    const result = {
      type: err.name,
      message: err.message,
      stack: err.stack,
    };
    // Check for optional code property (common on NodeJS errors)
    if (
      "code" in err &&
      typeof (/** @type {CommonError} */ (err).code) === "string"
    ) {
      result.code = /** @type {CommonError} */ (err).code;
    }
    return result;
  }

  return { message: String(err) };
}
