/**
 * @file src/utils/webhook_rate_limiter.js
 * @description Per-webhook rate limiter for DDoS protection on ingestion endpoints.
 * Uses a much higher limit than the management rate limiter to allow for webhook bursts.
 * @module utils/webhook_rate_limiter
 */
import { APP_CONSTS, ENV_VARS, ENV_VALUES } from "../consts/app.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { ERROR_MESSAGES } from "../consts/errors.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger({
  component: LOG_COMPONENTS.WEBHOOK_RATE_LIMITER,
});

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 */

/**
 * @typedef {Object} CheckResult
 * @property {boolean} allowed - Whether the request is allowed
 * @property {number} remaining - Number of requests remaining in the window
 * @property {number} resetMs - Time in milliseconds until the window resets
 */

/**
 * Rate limiter specifically designed for webhook ingestion.
 * Keys by webhookId (or IP if webhookId not available) with high limits.
 */
export class WebhookRateLimiter {
  /** @type {number} */
  #limit;
  /** @type {number} */
  #windowMs;
  /** @type {number} */
  #maxEntries;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  #cleanupInterval;

  /** @type {Map<string, number[]>} */
  #hits = new Map();

  /**
   * @param {number} limit - Max requests per window per webhook (default: 10000)
   * @param {number} windowMs - Window size in milliseconds (default: 60000)
   * @param {number} maxEntries - Max unique webhookIds to track (default: 10000)
   */
  constructor(
    limit = APP_CONSTS.DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE,
    windowMs = APP_CONSTS.DEFAULT_RATE_LIMIT_WINDOW_MS,
    maxEntries = APP_CONSTS.DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES,
  ) {
    if (
      typeof windowMs !== "number" ||
      !Number.isFinite(windowMs) ||
      windowMs <= 0
    ) {
      throw new Error(ERROR_MESSAGES.RATE_LIMITER_INVALID_WINDOW);
    }
    if (
      typeof maxEntries !== "number" ||
      !Number.isFinite(maxEntries) ||
      !Number.isInteger(maxEntries) ||
      maxEntries <= 0
    ) {
      throw new Error(ERROR_MESSAGES.RATE_LIMITER_INVALID_MAX_ENTRIES);
    }

    // Initialize fields
    this.#limit = limit; // Explicit initialization before setter used (though this.limit sets it too)
    this.limit = limit; // Validate and set via setter
    this.#windowMs = windowMs;
    this.#maxEntries = maxEntries;

    // Background pruning
    this.#cleanupInterval = global.setInterval(() => {
      const now = Date.now();
      const threshold = now - this.#windowMs;
      let prunedCount = 0;

      for (const [key, timestamps] of this.#hits.entries()) {
        const fresh = timestamps.filter((t) => t > threshold);
        if (fresh.length === 0) {
          this.#hits.delete(key);
          prunedCount++;
        } else {
          this.#hits.set(key, fresh);
        }
      }

      if (
        prunedCount > 0 &&
        process.env[ENV_VARS.NODE_ENV] !== ENV_VALUES.TEST
      ) {
        log.info({ prunedCount }, LOG_MESSAGES.WEBHOOK_RATELIMIT_PRUNED);
      }
    }, APP_CONSTS.DEFAULT_RATE_LIMIT_WINDOW_MS);
    if (this.#cleanupInterval.unref) this.#cleanupInterval.unref();
  }

  /**
   * @returns {number}
   */
  get limit() {
    return this.#limit;
  }

  /**
   * @param {number} value
   */
  set limit(value) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      throw new Error(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
    }
    this.#limit = value;
  }

  /**
   * Returns specific metrics for monitoring
   * @returns {number}
   */
  get entryCount() {
    return this.#hits.size;
  }

  /**
   * @returns {void}
   */
  destroy() {
    if (this.#cleanupInterval) global.clearInterval(this.#cleanupInterval);
  }

  /**
   * Checks if a webhook is rate limited.
   * @param {string} webhookId - The webhook identifier
   * @param {string} [clientIp] - Optional client IP for composite key
   * @returns {CheckResult}
   */
  check(webhookId, clientIp) {
    // Use composite key: webhookId:clientIp for finer granularity
    const key = clientIp ? `${webhookId}:${clientIp}` : webhookId;
    const now = Date.now();

    let userHits = this.#hits.get(key);

    if (!userHits) {
      // Enforce maxEntries cap for new clients
      if (this.#hits.size >= this.#maxEntries) {
        const oldestKey = this.#hits.keys().next().value;
        if (typeof oldestKey === "string") this.#hits.delete(oldestKey);
      }
      userHits = [];
    } else {
      // LRU: Re-insert to mark as recently used
      this.#hits.delete(key);
    }

    // Filter hits within the window
    const recentHits = userHits.filter((h) => now - h < this.#windowMs);

    if (recentHits.length >= this.#limit) {
      // Restore existing hits before returning
      this.#hits.set(key, recentHits);

      // Calculate reset time
      const oldestHit = recentHits[0] || now;
      const resetMs = this.#windowMs - (now - oldestHit);

      return {
        allowed: false,
        remaining: 0,
        resetMs: Math.max(0, resetMs),
      };
    }

    recentHits.push(now);
    this.#hits.set(key, recentHits);

    return {
      allowed: true,
      remaining: this.#limit - recentHits.length,
      resetMs: this.#windowMs,
    };
  }
}

/**
 * Default singleton instance with sensible defaults for webhook ingestion.
 * Uses the configured limit from consts (generous for burst traffic).
 */
export const webhookRateLimiter = new WebhookRateLimiter(
  APP_CONSTS.DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE,
  APP_CONSTS.DEFAULT_RATE_LIMIT_WINDOW_MS,
  APP_CONSTS.DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES,
);
