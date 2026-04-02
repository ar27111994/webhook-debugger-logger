/**
 * @file src/webhook_manager.js
 * @description Manages webhook lifecycle: creation, persistence, validation, and cleanup.
 * State is persisted to KeyValueStore to survive Actor restarts and migrations.
 * @module webhook_manager
 */
import { Actor } from "apify";
import { nanoid } from "nanoid";
import { ERROR_MESSAGES } from "./consts/errors.js";
import {
  WEBHOOK_ID_PREFIX,
  DEFAULT_ID_LENGTH,
  APP_CONSTS,
} from "./consts/app.js";
import { LOG_COMPONENTS } from "./consts/logging.js";
import {
  DUCKDB_VACUUM_ENABLED,
  DUCKDB_VACUUM_INTERVAL_MS,
} from "./consts/database.js";
import { KVS_KEYS } from "./consts/storage.js";
import { logRepository } from "./repositories/LogRepository.js";
import { vacuumDb } from "./db/duckdb.js";
import { createChildLogger, serializeError } from "./utils/logger.js";
import { LOG_MESSAGES } from "./consts/messages.js";
import { IS_TEST } from "./utils/env.js";

const log = createChildLogger({ component: LOG_COMPONENTS.WEBHOOK_MANAGER });

/**
 * @typedef {import('apify').KeyValueStore | null} KeyValueStore
 * @typedef {import('./typedefs.js').WebhookData} WebhookData
 */

export class WebhookManager {
  /** @type {Map<string, WebhookData>} */
  #webhooks = new Map();
  /** @type {KeyValueStore} */
  #kvStore = null;
  /** @type {string} */
  #STATE_KEY = KVS_KEYS.STATE;
  /** @type {number} */
  #lastVacuumTime = 0;
  /** @type {Promise<void>} */
  #persistPromise = Promise.resolve();

  /**
   * Internal configuration object using the "Injected Configuration" pattern.
   * This approach is preferred over direct use of global constants to:
   * 1. Ensure test stability by allowing deterministic overrides without module isolation.
   * 2. Avoid brittle 'jest.isolateModulesAsync' which can cause mock identity loss in ESM.
   * 3. Enable concurrent testing with different behaviors in the same process.
   */
  #config = {
    vacuumEnabled: DUCKDB_VACUUM_ENABLED,
    vacuumIntervalMs: DUCKDB_VACUUM_INTERVAL_MS,
  };

  /**
   * Initializes the WebhookManager.
   * Uses Dependency Injection for configuration to facilitate reliable unit testing.
   *
   * @param {Object} [options] - Initialization options.
   * @param {Object} [options.config] - Configuration overrides (primarily for tests).
   * @param {boolean} [options.config.vacuumEnabled] - Enable/disable DuckDB vacuuming.
   * @param {number} [options.config.vacuumIntervalMs] - Interval between vacuum operations.
   */
  constructor(options = {}) {
    this.#webhooks = new Map();
    this.#kvStore = null;
    this.#STATE_KEY = KVS_KEYS.STATE;
    this.#config = {
      ...this.#config,
      ...(options.config || {}),
    };
  }

  /**
   * Initializes the manager by restoring state from KeyValueStore.
   * This ensures webhooks persist across Actor restarts or migrations.
   */
  async init() {
    try {
      this.#kvStore = await Actor.openKeyValueStore();
      const savedState = await this.#kvStore.getValue(this.#STATE_KEY);
      if (savedState && typeof savedState === "object") {
        this.#webhooks = new Map(Object.entries(savedState));
        log.info(
          { count: this.#webhooks.size },
          LOG_MESSAGES.WEBHOOK_STATE_RESTORED,
        );
      }
    } catch (error) {
      log.error(
        { err: serializeError(error) },
        LOG_MESSAGES.WEBHOOK_STATE_INIT_FAILED,
      );
      // Fallback to empty map is already handled by constructor
    }
  }

  /**
   * Persists the current state (active webhooks) to KeyValueStore.
   * Linearized using a Promise chain to ensure atomicity and prevent race conditions
   * where stale snapshots overwrite newer state.
   *
   * @returns {Promise<void>}
   */
  async persist() {
    // Snapshots the state synchronously to ensure we capture current Map contents
    const state = Object.fromEntries(this.#webhooks);

    // Chain the persist operation purely sequentially
    this.#persistPromise = this.#persistPromise
      .then(async () => {
        try {
          if (!this.#kvStore) {
            this.#kvStore = await Actor.openKeyValueStore();
          }
          await this.#kvStore.setValue(this.#STATE_KEY, state);
        } catch (error) {
          log.error(
            { err: serializeError(error) },
            LOG_MESSAGES.WEBHOOK_STATE_PERSIST_FAILED,
          );
        }
      })
      .catch(() => {
        /* Handled in try/catch above */
      });

    return this.#persistPromise;
  }

  /**
   * Generates new unique webhook endpoints.
   * Enforces limits on count and retention.
   *
   * @param {number} count Number of webhooks to generate
   * @param {number} retentionHours Retention period in hours
   * @returns {Promise<string[]>} List of generated IDs
   */
  async generateWebhooks(count, retentionHours) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(ERROR_MESSAGES.INVALID_COUNT(count));
    }
    // count check handled by MAX_BULK_CREATE usage below
    if (count > APP_CONSTS.MAX_BULK_CREATE) {
      throw new Error(
        ERROR_MESSAGES.INVALID_COUNT_MAX(count, APP_CONSTS.MAX_BULK_CREATE),
      );
    }

    if (
      typeof retentionHours !== "number" ||
      retentionHours <= 0 ||
      !Number.isFinite(retentionHours)
    ) {
      throw new Error(ERROR_MESSAGES.INVALID_RETENTION(retentionHours));
    }
    const now = Date.now();
    const expiryMs = now + retentionHours * APP_CONSTS.MS_PER_HOUR;

    // Safety: Ensure we don't create an Invalid Date with extreme offsets
    if (!Number.isFinite(expiryMs)) {
      throw new Error(ERROR_MESSAGES.INVALID_RETENTION(retentionHours));
    }

    const expiresAt = new Date(expiryMs).toISOString();
    const newIds = [];

    for (let i = 0; i < count; i++) {
      const id = `${WEBHOOK_ID_PREFIX}${nanoid(DEFAULT_ID_LENGTH)}`;
      this.#webhooks.set(id, { expiresAt });
      newIds.push(id);
    }

    await this.persist();
    return newIds;
  }

  /**
   * Checks if a webhook ID is valid and not expired.
   * @param {string} id Webhook ID
   * @returns {boolean} True if valid
   */
  isValid(id) {
    const webhook = this.#webhooks.get(id);
    if (!webhook) return false;

    const now = new Date();
    const expiry = new Date(webhook.expiresAt);
    return now < expiry;
  }

  /**
   * Periodic cleanup task.
   * 1. Identifies expired webhooks.
   * 2. Deletes offloaded payloads from KVS.
   * 3. Deletes logs from DuckDB.
   * 4. Removes from memory.
   * 5. Triggers DuckDB vacuum if enabled.
   */
  async cleanup() {
    const now = new Date();
    let changed = false;

    if (!this.#kvStore) {
      this.#kvStore = await Actor.openKeyValueStore();
    }

    for (const [id, data] of this.#webhooks.entries()) {
      const expiry = new Date(data.expiresAt);
      // Logic Fix: items with malformed/invalid dates must be pruned to avoid leaks
      const isInvalidDate = !Number.isFinite(expiry.getTime());

      if (isInvalidDate || now > expiry) {
        try {
          // 1. Find and delete offloaded payloads
          const payloads = await logRepository.findOffloadedPayloads(id);
          let deletedCount = 0;
          for (const item of payloads) {
            if (item && item.key) {
              try {
                await this.#kvStore.setValue(item.key, null);
                deletedCount++;
              } catch (kvsErr) {
                log.warn(
                  { key: item.key, webhookId: id, err: serializeError(kvsErr) },
                  LOG_MESSAGES.KVS_DELETE_FAILED,
                );
              }
            }
          }
          if (deletedCount > 0) {
            log.info(
              { deleted: deletedCount, total: payloads.length, webhookId: id },
              LOG_MESSAGES.CLEANUP_DELETED_PAYLOADS,
            );
          }

          // 2. Delete logs from database
          await logRepository.deleteLogsByWebhookId(id);
          log.info({ webhookId: id }, LOG_MESSAGES.CLEANUP_WEBHOOK_REMOVED);
        } catch (err) {
          log.error(
            { webhookId: id, err: serializeError(err) },
            LOG_MESSAGES.CLEANUP_WEBHOOK_FAILED,
          );
        }

        // 3. Remove from memory
        this.#webhooks.delete(id);
        changed = true;
      }
    }

    if (changed) {
      await this.persist();

      // Periodic vacuum for SaaS/long-running instances
      if (this.#config.vacuumEnabled) {
        const now = Date.now();
        if (now - this.#lastVacuumTime > this.#config.vacuumIntervalMs) {
          // Logic Fix: update timestamp BEFORE awaiting to prevent "Vacuum Storm"
          // during concurrent cleanups on high-churn instances.
          this.#lastVacuumTime = now;
          try {
            await vacuumDb();
          } catch (vacuumErr) {
            // Reset on failure if we want to retry immediately, but typically
            // for DuckDB a failed vacuum means we should wait for the next interval
            // or the db is locked. We keep the new timestamp to suppress retries.
            log.warn(
              { err: serializeError(vacuumErr) },
              LOG_MESSAGES.VACUUM_FAILED,
            );
          }
        }
      }
    }
  }

  /**
   * Test-only helper to seed webhooks
   * @param {string} id
   * @param {WebhookData} data
   */
  addWebhookForTest(id, data) {
    if (IS_TEST()) {
      this.#webhooks.set(id, data);
    }
  }

  /**
   * Resets the vacuum timestamp for testing purposes.
   * @internal
   */
  resetVacuumForTest() {
    this.#lastVacuumTime = 0;
  }

  /**
   * Retrieves data for a webhook.
   * @param {string} id Webhook ID
   * @returns {WebhookData | undefined} Webhook data
   */
  getWebhookData(id) {
    return this.#webhooks.get(id);
  }

  /**
   * Returns current count of webhooks (active + expired)
   * @returns {number} Count of webhooks
   */
  get webhookCount() {
    return this.#webhooks.size;
  }

  /**
   * Test-only helper to check existence
   * @param {string} id
   * @returns {boolean} True if webhook exists
   */
  hasWebhook(id) {
    if (IS_TEST()) {
      return this.#webhooks.has(id);
    }
    return false;
  }

  /**
   * Returns all active webhooks.
   * @returns {WebhookData[]} Array of active webhooks
   */
  getAllActive() {
    return Array.from(this.#webhooks.entries())
      .filter(([id]) => this.isValid(id))
      .map(([id, data]) => ({
        id,
        ...data,
      }));
  }

  /**
   * Updates retention for all active webhooks.
   * @param {number} retentionHours New retention period in hours
   */
  async updateRetention(retentionHours) {
    if (
      isNaN(retentionHours) ||
      retentionHours <= 0 ||
      !Number.isFinite(retentionHours)
    ) {
      throw new Error(ERROR_MESSAGES.INVALID_RETENTION(retentionHours));
    }
    const now = Date.now();
    const newExpiryMs = now + retentionHours * APP_CONSTS.MS_PER_HOUR;
    const newExpiresAt = new Date(newExpiryMs).toISOString();
    let updatedCount = 0;

    let maxExtensionMs = 0;

    for (const [id, data] of this.#webhooks.entries()) {
      const currentExpiry = new Date(data.expiresAt).getTime();

      // Only extend retention for currently-active webhooks
      if (!Number.isFinite(currentExpiry) || currentExpiry <= now) continue;

      // We only EXTEND retention. We don't shrink it to avoid premature deletion of data
      // that the user might have expected to stay longer based on previous settings.
      if (newExpiryMs > currentExpiry) {
        maxExtensionMs = Math.max(maxExtensionMs, newExpiryMs - currentExpiry);
        this.#webhooks.set(id, { ...data, expiresAt: newExpiresAt });
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      // Suppress log for insignificant updates (< 5 minutes)
      if (maxExtensionMs > APP_CONSTS.RETENTION_LOG_SUPPRESSION_MS) {
        log.info(
          { count: updatedCount, total: this.#webhooks.size, retentionHours },
          LOG_MESSAGES.RETENTION_REFRESHED,
        );
      }
      await this.persist();
    }
  }
}
