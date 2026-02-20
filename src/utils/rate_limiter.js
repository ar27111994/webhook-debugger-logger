/**
 * @file src/utils/rate_limiter.js
 * @description Simple in-memory rate limiter with background pruning and eviction.
 * @module utils/rate_limiter
 */
import net from "node:net";
import { APP_CONSTS, ENV_VALUES, ENV_VARS } from "../consts/app.js";
import {
  HTTP_HEADERS,
  HTTP_CONSTS,
  HTTP_STATUS,
  HTTP_STATUS_MESSAGES,
} from "../consts/http.js";
import { LOG_COMPONENTS, LOG_CONSTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { ERROR_MESSAGES } from "../consts/errors.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger({ component: LOG_COMPONENTS.RATE_LIMITER });

/**
 * @typedef {import('express').RequestHandler} RequestHandler
 */

export class RateLimiter {
  /** @type {number} */
  #limit;
  /** @type {number} */
  #windowMs;
  /** @type {number} */
  #maxEntries;
  /** @type {boolean} */
  #trustProxy;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  #cleanupInterval;

  /** @type {Map<string, number[]>} */
  #hits = new Map();

  /**
   * @param {number} limit - Max requests per window
   * @param {number} windowMs - Window size in milliseconds
   * @param {number} maxEntries - Max unique IPs to track before eviction
   * @param {boolean} trustProxy - Whether to trust X-Forwarded-For/X-Real-IP headers
   */
  constructor(
    limit,
    windowMs,
    maxEntries = APP_CONSTS.DEFAULT_RATE_LIMIT_MAX_ENTRIES,
    trustProxy = false,
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
    this.#trustProxy = trustProxy;

    // Background pruning to avoid blocking the request path
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
        log.info({ prunedCount }, LOG_MESSAGES.RATELIMIT_PRUNED);
      }
    }, APP_CONSTS.DEFAULT_RATE_LIMIT_WINDOW_MS);
    if (this.#cleanupInterval?.unref) this.#cleanupInterval.unref();
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
      value < 0
    ) {
      throw new Error(ERROR_MESSAGES.RATE_LIMITER_INVALID_LIMIT);
    }
    this.#limit = value;
  }

  /**
   * Returns specific metric for validation/monitoring
   */
  get entryCount() {
    return this.#hits.size;
  }

  /**
   * Test-only helper to check if IP is tracked
   * @param {string} ip
   */
  hasIp(ip) {
    if (process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST) {
      return this.#hits.has(ip);
    }
    return false;
  }

  /**
   * Obfuscates an IP address for logging.
   * @param {string | undefined | null} ip
   * @returns {string}
   */
  maskIp(ip) {
    if (!ip) return LOG_MESSAGES.MASK_HIDDEN;
    if (ip.includes(":")) {
      // IPv6: Keep first significant segments
      const segments = ip.split(":");
      return (
        segments.slice(0, LOG_CONSTS.IPV6_MASK_SEGMENTS).join(":") +
        LOG_MESSAGES.MASK_IPV6_SUFFIX
      );
    }
    // IPv4: Mask last octet
    return (
      ip.split(".").slice(0, LOG_CONSTS.IPV4_MASK_OCTETS).join(".") +
      LOG_MESSAGES.MASK_IPV4_SUFFIX
    );
  }

  /**
   * Validates if a string is a valid IPv4 or IPv6 address.
   * @param {any} ip
   * @returns {boolean}
   */
  isValidIp(ip) {
    if (typeof ip !== "string") return false;
    return net.isIP(ip) !== 0;
  }

  /**
   * Extracts and validates the first IP from a header value (string or array).
   * @param {string | string[] | undefined} headerValue
   * @returns {string | undefined}
   */
  extractFirstValidIp(headerValue) {
    if (!headerValue) return undefined;

    const firstValue = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;

    if (!firstValue) return undefined;

    const ip = String(firstValue).split(",")[0].trim();
    return this.isValidIp(ip) ? ip : undefined;
  }

  destroy() {
    if (this.#cleanupInterval) global.clearInterval(this.#cleanupInterval);
  }

  /**
   * Express middleware for rate limiting.
   *
   * @security trustProxy allows spoofing if the Actor is exposed directly to the internet.
   * Only enable trustProxy if the Actor is behind a trusted reverse proxy (e.g., Apify API).
   * Headers are strictly validated to prevent malformed or malicious IP data propagation.
   * @returns {RequestHandler}
   */
  middleware() {
    return (req, res, next) => {
      /** @type {string | undefined} */
      let ip = req.ip || req.socket?.remoteAddress;

      if (this.#trustProxy) {
        const forwardedIp = this.extractFirstValidIp(
          req.headers?.[HTTP_HEADERS.X_FORWARDED_FOR],
        );
        const realIp = this.extractFirstValidIp(
          req.headers?.[HTTP_HEADERS.X_REAL_IP],
        );
        ip = forwardedIp || realIp || ip;
      }

      // Test hook to simulate missing IP metadata
      if (
        process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST &&
        req.headers[HTTP_HEADERS.X_SIMULATE_NO_IP]
      ) {
        ip = undefined;
      }

      if (!ip) {
        /** @type {string[]} */
        const safeHeaders = HTTP_CONSTS.SAFE_HEADERS;
        const loggedHeaders = Object.fromEntries(
          Object.entries(req.headers).filter(([key]) =>
            safeHeaders.includes(key.toLowerCase()),
          ),
        );

        log.warn(
          {
            userAgent: req.headers[HTTP_HEADERS.USER_AGENT],
            headers: loggedHeaders,
          },
          LOG_MESSAGES.RATELIMIT_REJECT_NO_IP,
        );
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          status: HTTP_STATUS.BAD_REQUEST,
          error: HTTP_STATUS_MESSAGES[HTTP_STATUS.BAD_REQUEST],
          message: ERROR_MESSAGES.RATE_LIMIT_NO_IP,
        });
      }

      const now = Date.now();
      let userHits = this.#hits.get(ip);

      if (!userHits) {
        // Enforce maxEntries cap for new clients
        if (this.#hits.size >= this.#maxEntries) {
          const oldestKey = this.#hits.keys().next().value;
          if (typeof oldestKey === "string") this.#hits.delete(oldestKey);
          if (
            process.env[ENV_VARS.NODE_ENV] !== ENV_VALUES.TEST &&
            typeof oldestKey === "string"
          ) {
            log.info(
              {
                evictedIp: this.maskIp(oldestKey),
                maxEntries: this.#maxEntries,
              },
              LOG_MESSAGES.RATELIMIT_EVICTED,
            );
          }
        }
        userHits = [];
      } else {
        // LRU: Re-insert to mark as recently used
        this.#hits.delete(ip);
      }

      // Filter hits within the window
      const recentHits = userHits.filter((h) => now - h < this.#windowMs);

      // Set rate limit headers for all responses
      const resetTime = Math.ceil(
        (now + this.#windowMs) / APP_CONSTS.MS_PER_SECOND,
      );
      res.setHeader(HTTP_HEADERS.X_RATELIMIT_LIMIT, this.#limit);
      res.setHeader(
        HTTP_HEADERS.X_RATELIMIT_REMAINING,
        Math.max(0, this.#limit - recentHits.length - 1),
      );
      res.setHeader(HTTP_HEADERS.X_RATELIMIT_RESET, resetTime);

      if (recentHits.length >= this.#limit) {
        // Restore existing hits before returning error (otherwise user is forgotten/reset)
        this.#hits.set(ip, recentHits);
        res.setHeader(
          HTTP_HEADERS.RETRY_AFTER,
          Math.ceil(this.#windowMs / APP_CONSTS.MS_PER_SECOND),
        );
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          status: HTTP_STATUS.TOO_MANY_REQUESTS,
          error: HTTP_STATUS_MESSAGES[HTTP_STATUS.TOO_MANY_REQUESTS],
          message: ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(
            this.#limit,
            this.#windowMs / APP_CONSTS.MS_PER_SECOND,
          ),
        });
      }

      recentHits.push(now);
      this.#hits.set(ip, recentHits);
      next();
    };
  }
}
