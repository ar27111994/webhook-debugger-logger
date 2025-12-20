import { Actor } from "apify";
import { nanoid } from "nanoid";

export class WebhookManager {
  constructor() {
    this.webhooks = new Map();
    this.kvStore = null;
    this.STATE_KEY = "WEBHOOK_STATE";
  }

  async init() {
    this.kvStore = await Actor.openKeyValueStore();
    const savedState = await this.kvStore.getValue(this.STATE_KEY);
    if (savedState) {
      this.webhooks = new Map(Object.entries(savedState));
    }
  }

  async persist() {
    const state = Object.fromEntries(this.webhooks);
    await this.kvStore.setValue(this.STATE_KEY, state);
  }

  async generateWebhooks(count, retentionHours) {
    const expiresAt = new Date(
      Date.now() + retentionHours * 60 * 60 * 1000
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
