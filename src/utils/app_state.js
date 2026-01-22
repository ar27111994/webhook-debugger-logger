import bodyParser from "body-parser";
import {
  DEFAULT_PAYLOAD_LIMIT,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_REPLAY_RETRIES,
  DEFAULT_REPLAY_TIMEOUT_MS,
} from "../consts.js";
import { RateLimiter } from "./rate_limiter.js";

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
    this.webhookManager = webhookManager;
    this.loggerMiddleware = loggerMiddleware;

    // Core State
    this.authKey = config.authKey || "";
    this.maxPayloadSize = config.maxPayloadSize || DEFAULT_PAYLOAD_LIMIT;
    this.retentionHours = config.retentionHours;
    this.urlCount = config.urlCount;
    this.replayMaxRetries = config.replayMaxRetries || DEFAULT_REPLAY_RETRIES;
    this.replayTimeoutMs = config.replayTimeoutMs || DEFAULT_REPLAY_TIMEOUT_MS;

    // Rate Limiter
    this.rateLimiter = new RateLimiter(
      config.rateLimitPerMinute || DEFAULT_RATE_LIMIT_PER_MINUTE,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    );

    // Body Parser (recreated when maxPayloadSize changes)
    this.bodyParser = this._createBodyParser();
  }

  /**
   * Creates the body parser middleware with current limits.
   * @private
   */
  _createBodyParser() {
    return bodyParser.raw({
      limit: this.maxPayloadSize,
      type: "*/*",
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
      console.log(
        `[SYSTEM] Updating Max Payload Size to ${validated.maxPayloadSize} bytes`,
      );
      this.maxPayloadSize = validated.maxPayloadSize;
      this.bodyParser = this._createBodyParser();
    }

    // 3. Update Rate Limiter
    const newRateLimit = validated.rateLimitPerMinute;
    if (this.rateLimiter.limit !== newRateLimit) {
      console.log(`[SYSTEM] Updating Rate Limit to ${newRateLimit} req/min`);
      this.rateLimiter.limit = newRateLimit;
    }

    // 4. Update Auth Key
    if (validated.authKey !== this.authKey) {
      // Sensitive, so maybe don't log the key itself
      console.log("[SYSTEM] Auth Key updated");
      this.authKey = validated.authKey;
    }

    // 5. Re-reconcile URL count
    this.urlCount = validated.urlCount;
    const activeWebhooks = this.webhookManager.getAllActive();
    if (activeWebhooks.length < this.urlCount) {
      const diff = this.urlCount - activeWebhooks.length;
      console.log(
        `[SYSTEM] Dynamic Scale-up: Generating ${diff} additional webhook(s).`,
      );
      await this.webhookManager.generateWebhooks(
        diff,
        this.retentionHours || 24,
      ); // Use current retention
    }

    // 6. Update Retention
    if (validated.retentionHours !== this.retentionHours) {
      console.log(
        `[SYSTEM] Updating Retention Policy to ${validated.retentionHours} hours`,
      );
      this.retentionHours = validated.retentionHours;
      await this.webhookManager.updateRetention(this.retentionHours);
    }

    if (validated.replayMaxRetries !== this.replayMaxRetries) {
      console.log(
        `[SYSTEM] Updating Replay Max Retries to ${validated.replayMaxRetries}`,
      );
      this.replayMaxRetries = validated.replayMaxRetries;
    }

    if (validated.replayTimeoutMs !== this.replayTimeoutMs) {
      console.log(
        `[SYSTEM] Updating Replay Timeout to ${validated.replayTimeoutMs}ms`,
      );
      this.replayTimeoutMs = validated.replayTimeoutMs;
    }
  }

  /**
   * Clean up resources.
   */
  destroy() {
    if (this.rateLimiter) this.rateLimiter.destroy();
  }
}
