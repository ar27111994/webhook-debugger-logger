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
  ENV_VARS,
  ENV_VALUES,
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

  constructor() {
    this.#webhooks = new Map();
    this.#kvStore = null;
    this.#STATE_KEY = KVS_KEYS.STATE;
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
   * Atomic operation to ensure consistency.
   */
  async persist() {
    try {
      const state = Object.fromEntries(this.#webhooks);
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
    const expiresAt = new Date(
      Date.now() + retentionHours * APP_CONSTS.MS_PER_HOUR,
    ).toISOString();
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
      if (now > new Date(data.expiresAt)) {
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
      if (DUCKDB_VACUUM_ENABLED) {
        const now = Date.now();
        if (now - this.#lastVacuumTime > DUCKDB_VACUUM_INTERVAL_MS) {
          try {
            await vacuumDb();
            this.#lastVacuumTime = now;
          } catch (vacuumErr) {
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
    if (process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST) {
      this.#webhooks.set(id, data);
    }
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
   */
  get webhookCount() {
    return this.#webhooks.size;
  }

  /**
   * Test-only helper to check existence
   * @param {string} id
   */
  hasWebhook(id) {
    if (process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST) {
      return this.#webhooks.has(id);
    }
    return false;
  }

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
