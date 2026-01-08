import { Actor } from "apify";
import { nanoid } from "nanoid";

export class WebhookManager {
  constructor() {
    /** @type {Map<string, {expiresAt: string}>} */
    this.webhooks = new Map();
    /** @type {import('apify').KeyValueStore | null} */
    this.kvStore = null;
    this.STATE_KEY = "WEBHOOK_STATE";
  }

  async init() {
    try {
      this.kvStore = await Actor.openKeyValueStore();
      const savedState = await this.kvStore.getValue(this.STATE_KEY);
      if (savedState && typeof savedState === "object") {
        this.webhooks = new Map(Object.entries(savedState));
        console.log(
          `[STORAGE] Restored ${this.webhooks.size} webhooks from state.`,
        );
      }
    } catch (error) {
      console.error(
        "[CRITICAL] Failed to initialize WebhookManager state:",
        /** @type {Error} */ (error).message,
      );
      // Fallback to empty map is already handled by constructor
    }
  }

  async persist() {
    try {
      const state = Object.fromEntries(this.webhooks);
      if (this.kvStore) {
        await this.kvStore.setValue(this.STATE_KEY, state);
      }
    } catch (error) {
      console.error(
        "[STORAGE-ERROR] Failed to persist webhook state:",
        /** @type {Error} */ (error).message,
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
    const expiresAt = new Date(
      Date.now() + retentionHours * 60 * 60 * 1000,
    ).toISOString();
    const newIds = [];

    for (let i = 0; i < count; i++) {
      const id = `wh_${nanoid(10)}`;
      this.webhooks.set(id, { expiresAt });
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
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;

    const now = new Date();
    const expiry = new Date(webhook.expiresAt);
    return now < expiry;
  }

  async cleanup() {
    const now = new Date();
    let changed = false;

    for (const [id, data] of this.webhooks.entries()) {
      if (now > new Date(data.expiresAt)) {
        this.webhooks.delete(id);
        changed = true;
      }
    }

    if (changed) {
      await this.persist();
    }
  }

  /**
   * Retrieves data for a webhook.
   * @param {string} id Webhook ID
   * @returns {{expiresAt: string} | undefined} Webhook data
   */
  getWebhookData(id) {
    return this.webhooks.get(id);
  }

  getAllActive() {
    return Array.from(this.webhooks.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }

  /**
   * Updates retention for all active webhooks.
   * @param {number} retentionHours New retention period in hours
   */
  async updateRetention(retentionHours) {
    const now = Date.now();
    const newExpiresAt = new Date(
      now + retentionHours * 60 * 60 * 1000,
    ).toISOString();
    let changed = false;

    for (const [id, data] of this.webhooks.entries()) {
      const currentExpiry = new Date(data.expiresAt).getTime();
      const newExpiry = new Date(newExpiresAt).getTime();

      // We only EXTEND retention. We don't shrink it to avoid premature deletion of data
      // that the user might have expected to stay longer based on previous settings.
      if (newExpiry > currentExpiry) {
        this.webhooks.set(id, { ...data, expiresAt: newExpiresAt });
        changed = true;
      }
    }

    if (changed) {
      console.log(
        `[STORAGE] Extended retention for ${this.webhooks.size} webhooks to ${retentionHours}h.`,
      );
      await this.persist();
    }
  }
}
