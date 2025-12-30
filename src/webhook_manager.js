import { Actor } from "apify";
import { nanoid } from "nanoid";

export class WebhookManager {
  constructor() {
    this.webhooks = new Map();
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
        error.message,
      );
      // Fallback to empty map is already handled by constructor
    }
  }

  async persist() {
    try {
      const state = Object.fromEntries(this.webhooks);
      await this.kvStore.setValue(this.STATE_KEY, state);
    } catch (error) {
      console.error(
        "[STORAGE-ERROR] Failed to persist webhook state:",
        error.message,
      );
    }
  }

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

  getWebhookData(id) {
    return this.webhooks.get(id);
  }

  getAllActive() {
    return Array.from(this.webhooks.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }
}
