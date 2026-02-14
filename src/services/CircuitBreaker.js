/**
 * @file src/services/CircuitBreaker.js
 * @description In-memory Circuit Breaker to prevent cascading failures to dead hosts.
 * @module services/CircuitBreaker
 */
import { FORWARDING_CONSTS } from "../consts/app.js";

/**
 * @typedef {Object} CircuitState
 * @property {number} failures - Number of consecutive failures
 * @property {number} nextAttempt - Timestamp when circuit should open
 */

/**
 * In-memory Circuit Breaker to prevent cascading failures to dead hosts.
 * Includes periodic cleanup to prevent memory leaks.
 *
 * SCOPE: Operates at HOSTNAME level (not per-endpoint).
 * - A failure on api.example.com/endpoint-a will block api.example.com/endpoint-b
 * - This is intentional to protect against host-wide issues
 * - To change scope, modify the key generation in recordFailure/recordSuccess/isOpen
 */
export class CircuitBreaker {
  constructor() {
    /** @type {Map<string, CircuitState>} */
    this.states = new Map();
    this.failureThreshold = FORWARDING_CONSTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    this.resetTimeoutMs = FORWARDING_CONSTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS;
    this.maxSize = FORWARDING_CONSTS.CIRCUIT_BREAKER_MAX_SIZE;

    // Periodic cleanup of stale entries
    this.cleanupInterval = setInterval(() => {
      this.prune();
    }, FORWARDING_CONSTS.CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  /**
   * Prunes expired or excess entries.
   */
  prune() {
    const now = Date.now();
    for (const [hostname, state] of this.states) {
      if (state.nextAttempt < now && state.failures === 0) {
        this.states.delete(hostname);
      }
    }

    // LRU-ish eviction if still too large
    if (this.states.size > this.maxSize) {
      const toDeleteCount = this.states.size - this.maxSize;
      // Convert iterator to array before modification
      const keysToDelete = Array.from(this.states.keys()).slice(
        0,
        toDeleteCount,
      );
      for (const key of keysToDelete) {
        this.states.delete(key);
      }
    }
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  isOpen(url) {
    try {
      const hostname = new URL(url).hostname;
      const state = this.states.get(hostname);
      if (!state) return false;

      if (state.failures >= this.failureThreshold) {
        // Open if reset timeout hasn't passed
        return Date.now() < state.nextAttempt;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} url
   */
  recordFailure(url) {
    try {
      const hostname = new URL(url).hostname;
      const now = Date.now();
      const state = this.states.get(hostname) || {
        failures: 0,
        nextAttempt: 0,
      };

      state.failures++;
      state.nextAttempt = now + this.resetTimeoutMs;
      this.states.set(hostname, state);
    } catch {
      // Ignore invalid URLs
    }
  }

  /**
   * @param {string} url
   */
  recordSuccess(url) {
    try {
      const hostname = new URL(url).hostname;
      if (this.states.has(hostname)) {
        this.states.delete(hostname);
      }
    } catch {
      // Ignore
    }
  }

  destroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }
}
