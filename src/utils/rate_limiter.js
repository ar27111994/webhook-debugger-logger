/**
 * Simple in-memory rate limiter with background pruning and eviction.
 */
import net from "node:net";
import { DEFAULT_RATE_LIMIT_WINDOW_MS } from "../consts.js";

export class RateLimiter {
  /**
   * @param {number} limit - Max requests per window
   * @param {number} windowMs - Window size in milliseconds
   * @param {number} maxEntries - Max unique IPs to track before eviction
   * @param {boolean} trustProxy - Whether to trust X-Forwarded-For/X-Real-IP headers
   */
  constructor(limit, windowMs, maxEntries = 1000, trustProxy = false) {
    if (
      typeof limit !== "number" ||
      !Number.isFinite(limit) ||
      !Number.isInteger(limit) ||
      limit < 0
    ) {
      throw new Error("RateLimiter: limit must be a finite integer >= 0");
    }
    if (
      typeof windowMs !== "number" ||
      !Number.isFinite(windowMs) ||
      windowMs <= 0
    ) {
      throw new Error("RateLimiter: windowMs must be a finite number > 0");
    }
    if (
      typeof maxEntries !== "number" ||
      !Number.isFinite(maxEntries) ||
      !Number.isInteger(maxEntries) ||
      maxEntries <= 0
    ) {
      throw new Error("RateLimiter: maxEntries must be a finite integer > 0");
    }

    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.trustProxy = trustProxy;
    this.hits = /** @type {Map<string, number[]>} */ (new Map());

    // Background pruning to avoid blocking the request path
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const threshold = now - this.windowMs;
      let prunedCount = 0;

      for (const [key, timestamps] of this.hits.entries()) {
        const fresh = timestamps.filter((t) => t > threshold);
        if (fresh.length === 0) {
          this.hits.delete(key);
          prunedCount++;
        } else {
          this.hits.set(key, fresh);
        }
      }

      if (prunedCount > 0 && process.env.NODE_ENV !== "test") {
        console.log(
          `[SYSTEM] RateLimiter pruned ${prunedCount} expired entries.`,
        );
      }
    }, DEFAULT_RATE_LIMIT_WINDOW_MS);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  /**
   * Obfuscates an IP address for logging.
   * @param {string | undefined | null} ip
   * @returns {string}
   */
  maskIp(ip) {
    if (!ip) return "unknown";
    if (ip.includes(":")) {
      // IPv6: Keep first 2 segments
      const segments = ip.split(":");
      return segments.slice(0, 2).join(":") + ":****";
    }
    // IPv4: Mask last octet
    return ip.split(".").slice(0, 3).join(".") + ".****";
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
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  /**
   * Express middleware for rate limiting.
   *
   * @security trustProxy allows spoofing if the Actor is exposed directly to the internet.
   * Only enable trustProxy if the Actor is behind a trusted reverse proxy (e.g., Apify API).
   * Headers are strictly validated to prevent malformed or malicious IP data propagation.
   * @returns {import('express').RequestHandler}
   */
  middleware() {
    return (req, res, next) => {
      /** @type {string | undefined} */
      let ip = req.ip || req.socket?.remoteAddress;

      if (this.trustProxy) {
        const forwardedIp = this.extractFirstValidIp(
          req.headers?.["x-forwarded-for"],
        );
        const realIp = this.extractFirstValidIp(req.headers?.["x-real-ip"]);
        ip = forwardedIp || realIp || ip;
      }

      // Test hook to simulate missing IP metadata
      if (process.env.NODE_ENV === "test" && req.headers["x-simulate-no-ip"]) {
        ip = undefined;
      }

      if (!ip) {
        const safeHeaders = ["user-agent", "accept-language", "referer"];
        const loggedHeaders = Object.fromEntries(
          Object.entries(req.headers).filter(([key]) =>
            safeHeaders.includes(key.toLowerCase()),
          ),
        );

        console.warn("[SECURITY] Rejecting request with unidentifiable IP:", {
          userAgent: req.headers["user-agent"],
          headers: loggedHeaders,
        });
        return res.status(400).json({
          status: 400,
          error: "Bad Request",
          message:
            "Client IP could not be identified. Ensure your request includes standard IP headers if behind a proxy.",
        });
      }

      const now = Date.now();
      let userHits = this.hits.get(ip);

      if (!userHits) {
        // Enforce maxEntries cap for new clients
        if (this.hits.size >= this.maxEntries) {
          const oldestKey = this.hits.keys().next().value;
          if (typeof oldestKey === "string") this.hits.delete(oldestKey);
          if (
            process.env.NODE_ENV !== "test" &&
            typeof oldestKey === "string"
          ) {
            console.log(
              `[SYSTEM] RateLimiter evicted entry for ${this.maskIp(
                oldestKey,
              )} (Cap: ${this.maxEntries})`,
            );
          }
        }
        userHits = [];
      } else {
        // LRU: Re-insert to mark as recently used
        this.hits.delete(ip);
      }

      // Filter hits within the window
      const recentHits = userHits.filter((h) => now - h < this.windowMs);
      if (recentHits.length >= this.limit) {
        return res.status(429).json({
          status: 429,
          error: "Too Many Requests",
          message: `Rate limit exceeded. Max ${this.limit} requests per ${
            this.windowMs / 1000
          }s.`,
        });
      }

      recentHits.push(now);
      this.hits.set(ip, recentHits);
      next();
    };
  }
}
