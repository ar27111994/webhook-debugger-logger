/**
 * @file src/utils/app_state.js
 * @description Manages application runtime state and propagates configuration updates to components.
 */
import bodyParser from "body-parser";
import {
  DEFAULT_PAYLOAD_LIMIT,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_REPLAY_RETRIES,
  DEFAULT_REPLAY_TIMEOUT_MS,
  DEFAULT_FIXED_MEMORY_MBYTES,
} from "../consts.js";
import { RateLimiter } from "./rate_limiter.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger({ component: "AppState" });

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
    this.useFixedMemory = config.useFixedMemory ?? false;
    this.fixedMemoryMbytes =
      config.fixedMemoryMbytes ?? DEFAULT_FIXED_MEMORY_MBYTES;

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
   * @returns {RequestHandler}
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
      log.info(
        { maxPayloadSize: validated.maxPayloadSize },
        "Updating max payload size",
      );
      this.maxPayloadSize = validated.maxPayloadSize;
      this.bodyParser = this._createBodyParser();
    }

    // 3. Update Rate Limiter
    const newRateLimit = validated.rateLimitPerMinute;
    if (this.rateLimiter.limit !== newRateLimit) {
      log.info({ rateLimit: newRateLimit }, "Updating rate limit");
      this.rateLimiter.limit = newRateLimit;
    }

    // 4. Update Auth Key
    if (validated.authKey !== this.authKey) {
      // Sensitive, so maybe don't log the key itself
      log.info("Auth key updated");
      this.authKey = validated.authKey;
    }

    // 5. Re-reconcile URL count
    this.urlCount = validated.urlCount;
    const activeWebhooks = this.webhookManager.getAllActive();
    if (activeWebhooks.length < this.urlCount) {
      const diff = this.urlCount - activeWebhooks.length;
      log.info(
        { count: diff },
        "Dynamic scale-up: generating additional webhook(s)",
      );
      await this.webhookManager.generateWebhooks(
        diff,
        this.retentionHours || 24,
      ); // Use current retention
    }

    // 6. Update Retention
    if (validated.retentionHours !== this.retentionHours) {
      log.info(
        { retentionHours: validated.retentionHours },
        "Updating retention policy",
      );
      this.retentionHours = validated.retentionHours;
      await this.webhookManager.updateRetention(this.retentionHours);
    }

    if (validated.replayMaxRetries !== this.replayMaxRetries) {
      log.info(
        { replayMaxRetries: validated.replayMaxRetries },
        "Updating replay max retries",
      );
      this.replayMaxRetries = validated.replayMaxRetries;
    }

    if (validated.replayTimeoutMs !== this.replayTimeoutMs) {
      log.info(
        { replayTimeoutMs: validated.replayTimeoutMs },
        "Updating replay timeout",
      );
      this.replayTimeoutMs = validated.replayTimeoutMs;
    }

    if (validated.useFixedMemory !== this.useFixedMemory) {
      log.info(
        { useFixedMemory: validated.useFixedMemory },
        "Updating fixed memory toggle",
      );
      this.useFixedMemory = validated.useFixedMemory;
    }

    if (validated.fixedMemoryMbytes !== this.fixedMemoryMbytes) {
      log.info(
        { fixedMemoryMbytes: validated.fixedMemoryMbytes },
        "Updating manual memory target",
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
