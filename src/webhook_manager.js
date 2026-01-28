import { Actor } from "apify";
import { nanoid } from "nanoid";
import { MAX_BULK_CREATE } from "./consts.js";

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
  #STATE_KEY = "WEBHOOK_STATE";

  constructor() {
    this.#webhooks = new Map();
    this.#kvStore = null;
    this.#STATE_KEY = "WEBHOOK_STATE";
  }

  async init() {
    try {
      this.#kvStore = await Actor.openKeyValueStore();
      const savedState = await this.#kvStore.getValue(this.#STATE_KEY);
      if (savedState && typeof savedState === "object") {
        this.#webhooks = new Map(Object.entries(savedState));
        console.log(
          `[STORAGE] Restored ${this.#webhooks.size} webhooks from state.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");
      console.error(
        "[CRITICAL] Failed to initialize WebhookManager state:",
        message,
      );
      // Fallback to empty map is already handled by constructor
    }
  }

  async persist() {
    try {
      const state = Object.fromEntries(this.#webhooks);
      if (!this.#kvStore) {
        this.#kvStore = await Actor.openKeyValueStore();
      }
      await this.#kvStore.setValue(this.#STATE_KEY, state);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");
      console.error(
        "[STORAGE-ERROR] Failed to persist webhook state:",
        message,
      );
    }
  }

  /**
   * Generates new webhooks.
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
      const id = `wh_${nanoid(10)}`;
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

  async cleanup() {
    const now = new Date();
    let changed = false;

    for (const [id, data] of this.#webhooks.entries()) {
      if (now > new Date(data.expiresAt)) {
        this.#webhooks.delete(id);
        changed = true;
      }
    }

    if (changed) {
      await this.persist();
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
      if (maxExtensionMs > 5 * 60 * 1000) {
        console.log(
          `[STORAGE] Refreshed retention for ${updatedCount} of ${this.#webhooks.size} webhooks to ${retentionHours}h.`,
        );
      }
      await this.persist();
    }
  }
}
