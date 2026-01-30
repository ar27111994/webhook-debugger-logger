/**
 * @file src/utils/events.js
 * @description Centralized event emitter for internal application events (e.g., log:received).
 */
import { EventEmitter } from "node:events";

import { EVENT_MAX_LISTENERS } from "../consts.js";

/**
 * @typedef {import('../typedefs.js').WebhookEvent} WebhookEvent
 */

/**
 * Singleton EventEmitter for internal application events.
 */
export const appEvents = new EventEmitter();

// Increase limit if we have many listeners (though likely just one for now)
appEvents.setMaxListeners(EVENT_MAX_LISTENERS);

/**
 * @typedef {Object} AppEvents
 * @property {(payload: WebhookEvent) => void} logReceived
 */

export const EVENTS = {
  LOG_RECEIVED: "log:received",
};
