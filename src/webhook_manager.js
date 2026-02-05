/**
 * @file src/webhook_manager.js
 * @description Manages webhook lifecycle: creation, persistence, validation, and cleanup.
 * State is persisted to KeyValueStore to survive Actor restarts and migrations.
 */
import { Actor } from "apify";
import { nanoid } from "nanoid";
import {
  MAX_BULK_CREATE,
  WEBHOOK_ID_PREFIX,
  DEFAULT_ID_LENGTH,
  RETENTION_LOG_SUPPRESSION_MS,
  DUCKDB_VACUUM_ENABLED,
  DUCKDB_VACUUM_INTERVAL_MS,
  KVS_STATE_KEY,
} from "./consts.js";
import { logRepository } from "./repositories/LogRepository.js";
import { vacuumDb } from "./db/duckdb.js";
import { createChildLogger, serializeError } from "./utils/logger.js";

const log = createChildLogger({ component: "WebhookManager" });

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
  #STATE_KEY = KVS_STATE_KEY;
  /** @type {number} */
  #lastVacuumTime = 0;

  constructor() {
    this.#webhooks = new Map();
    this.#kvStore = null;
    this.#STATE_KEY = KVS_STATE_KEY;
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
          "Restored webhooks from state",
        );
      }
    } catch (error) {
      log.error(
        { err: serializeError(error) },
        "Failed to initialize WebhookManager state",
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
        "Failed to persist webhook state",
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
      throw new Error(
        `Invalid count: ${count}. Must be a non-negative integer.`,
      );
    }
    // count check handled by MAX_BULK_CREATE usage below
    if (count > MAX_BULK_CREATE) {
      throw new Error(
        `Invalid count: ${count}. Max allowed is ${MAX_BULK_CREATE}.`,
      );
    }

    if (
      typeof retentionHours !== "number" ||
      retentionHours <= 0 ||
      !Number.isFinite(retentionHours)
    ) {
      throw new Error(
        `Invalid retentionHours: ${retentionHours}. Must be a positive number.`,
      );
    }
    const expiresAt = new Date(
      Date.now() + retentionHours * 60 * 60 * 1000,
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
                  "Failed to delete KVS key during cleanup",
                );
              }
            }
          }
          if (deletedCount > 0) {
            log.info(
              { deleted: deletedCount, total: payloads.length, webhookId: id },
              "Deleted offloaded payloads",
            );
          }

          // 2. Delete logs from database
          await logRepository.deleteLogsByWebhookId(id);

          log.info({ webhookId: id }, "Removed expired webhook and data");
        } catch (err) {
          log.error(
            { webhookId: id, err: serializeError(err) },
            "Failed to clean up webhook",
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
              "DuckDB vacuum failed",
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
    if (process.env.NODE_ENV === "test") {
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
    if (process.env.NODE_ENV === "test") {
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
      typeof retentionHours !== "number" ||
      retentionHours <= 0 ||
      !Number.isFinite(retentionHours)
    ) {
      throw new Error(
        `Invalid retentionHours: ${retentionHours}. Must be a positive number.`,
      );
    }
    const now = Date.now();
    const newExpiryMs = now + retentionHours * 60 * 60 * 1000;
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
      if (maxExtensionMs > RETENTION_LOG_SUPPRESSION_MS) {
        log.info(
          { count: updatedCount, total: this.#webhooks.size, retentionHours },
          "Refreshed webhook retention",
        );
      }
      await this.persist();
    }
  }
}
