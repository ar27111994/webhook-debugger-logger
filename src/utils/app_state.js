/**
 * @file src/utils/app_state.js
 * @description Manages application runtime state and propagates configuration updates to components.
 * @module utils/app_state
 */
import bodyParser from "body-parser";
import { APP_CONSTS } from "../consts/app.js";
import { MIME_TYPES } from "../consts/http.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { RateLimiter } from "./rate_limiter.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger({ component: LOG_COMPONENTS.APP_STATE });

/**
 * @typedef {import('express').RequestHandler} RequestHandler
 * @typedef {import('../webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../logger_middleware.js').LoggerMiddleware} LoggerMiddleware
 * @typedef {import('./config.js').WebhookConfig} WebhookConfig
 * @typedef {import('./config.js').RuntimeOptions} RuntimeOptions
 */

/**
 * Manages the application's runtime state, traversing configuration updates
 * to various components (middleware, rate limiters, etc.).
 */
export class AppState {
  /**
   * @param {WebhookConfig} config - Initial configuration object
   * @param {WebhookManager} webhookManager
   * @param {LoggerMiddleware} loggerMiddleware
   */
  constructor(config, webhookManager, loggerMiddleware) {
    /** @type {WebhookManager} */
    this.webhookManager = webhookManager;
    /** @type {LoggerMiddleware} */
    this.loggerMiddleware = loggerMiddleware;

    // Core State
    /** @type {string} */
    this.authKey = config.authKey || "";
    /** @type {number} */
    this.maxPayloadSize =
      config.maxPayloadSize || APP_CONSTS.DEFAULT_PAYLOAD_LIMIT;
    /** @type {number} */
    this.retentionHours = Number(config.retentionHours);
    /** @type {number} */
    this.urlCount = Number(config.urlCount);
    /** @type {number} */
    this.replayMaxRetries =
      config.replayMaxRetries || APP_CONSTS.DEFAULT_REPLAY_RETRIES;
    /** @type {number} */
    this.replayTimeoutMs =
      config.replayTimeoutMs || APP_CONSTS.DEFAULT_REPLAY_TIMEOUT_MS;
    /** @type {boolean} */
    this.useFixedMemory = config.useFixedMemory ?? false;
    /** @type {number} */
    this.fixedMemoryMbytes =
      config.fixedMemoryMbytes ?? APP_CONSTS.DEFAULT_FIXED_MEMORY_MBYTES;

    // Rate Limiter
    /** @type {RateLimiter} */
    this.rateLimiter = new RateLimiter(
      config.rateLimitPerMinute || APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE,
      APP_CONSTS.DEFAULT_RATE_LIMIT_WINDOW_MS,
    );

    // Body Parser (recreated when maxPayloadSize changes)
    /** @type {RequestHandler} */
    this.bodyParser = this._createBodyParser();
  }

  /**
   * Creates the body parser middleware with current limits.
   * @private
   * @returns {RequestHandler}
   */
  _createBodyParser() {
    return bodyParser.raw({
      limit: this.maxPayloadSize,
      type: MIME_TYPES.WILDCARD,
    });
  }

  /**
   * Express middleware for request body parsing.
   * Dynamically uses the current parser instance.
   * @returns {RequestHandler}
   */
  get bodyParserMiddleware() {
    return (req, res, next) => this.bodyParser(req, res, next);
  }

  /**
   * Express middleware for rate limiting.
   * @returns {RequestHandler}
   */
  get rateLimitMiddleware() {
    return this.rateLimiter.middleware();
  }

  /**
   * Applies a hot-reload configuration update.
   * @param {Object} normalizedInput - The full input object (for options that don't need validation/coercion)
   * @param {RuntimeOptions} validated - The coerced runtime options
   */
  async applyConfigUpdate(normalizedInput, validated) {
    // 1. Update Middleware (response codes, delays, headers, forwarding)
    // Note: loggerMiddleware handles its own internal state updates via updateOptions
    this.loggerMiddleware.updateOptions(normalizedInput);

    // 2. Update Body Parser if limit changed
    if (validated.maxPayloadSize !== this.maxPayloadSize) {
      log.info(
        { maxPayloadSize: validated.maxPayloadSize },
        LOG_MESSAGES.UPDATE_MAX_PAYLOAD,
      );
      this.maxPayloadSize = validated.maxPayloadSize;
      this.bodyParser = this._createBodyParser();
    }

    // 3. Update Rate Limiter
    const newRateLimit = validated.rateLimitPerMinute;
    if (this.rateLimiter.limit !== newRateLimit) {
      log.info({ rateLimit: newRateLimit }, LOG_MESSAGES.UPDATE_RATE_LIMIT);
      this.rateLimiter.limit = newRateLimit;
    }

    // 4. Update Auth Key
    if (validated.authKey !== this.authKey) {
      // Sensitive, so maybe don't log the key itself
      log.info(LOG_MESSAGES.AUTH_KEY_UPDATED);
      this.authKey = validated.authKey;
    }

    // 5. Re-reconcile URL count
    this.urlCount = validated.urlCount;
    const activeWebhooks = this.webhookManager.getAllActive();
    if (activeWebhooks.length < this.urlCount) {
      const diff = this.urlCount - activeWebhooks.length;
      log.info({ count: diff }, LOG_MESSAGES.DYNAMIC_SCALE_UP);
      await this.webhookManager.generateWebhooks(
        diff,
        this.retentionHours || APP_CONSTS.DEFAULT_RETENTION_HOURS,
      ); // Use current retention
    }

    // 6. Update Retention
    if (validated.retentionHours !== this.retentionHours) {
      log.info(
        { retentionHours: validated.retentionHours },
        LOG_MESSAGES.UPDATE_RETENTION,
      );
      this.retentionHours = validated.retentionHours;
      await this.webhookManager.updateRetention(this.retentionHours);
    }

    if (validated.replayMaxRetries !== this.replayMaxRetries) {
      log.info(
        { replayMaxRetries: validated.replayMaxRetries },
        LOG_MESSAGES.UPDATE_REPLAY_RETRIES,
      );
      this.replayMaxRetries = validated.replayMaxRetries;
    }

    if (validated.replayTimeoutMs !== this.replayTimeoutMs) {
      log.info(
        { replayTimeoutMs: validated.replayTimeoutMs },
        LOG_MESSAGES.UPDATE_REPLAY_TIMEOUT,
      );
      this.replayTimeoutMs = validated.replayTimeoutMs;
    }

    if (validated.useFixedMemory !== this.useFixedMemory) {
      log.info(
        { useFixedMemory: validated.useFixedMemory },
        LOG_MESSAGES.UPDATE_FIXED_MEMORY,
      );
      this.useFixedMemory = validated.useFixedMemory;
    }

    if (validated.fixedMemoryMbytes !== this.fixedMemoryMbytes) {
      log.info(
        { fixedMemoryMbytes: validated.fixedMemoryMbytes },
        LOG_MESSAGES.UPDATE_MANUAL_MEMORY,
      );
      this.fixedMemoryMbytes = validated.fixedMemoryMbytes;
    }
  }

  /**
   * Clean up resources.
   */
  destroy() {
    if (this.rateLimiter) this.rateLimiter.destroy();
  }
}
