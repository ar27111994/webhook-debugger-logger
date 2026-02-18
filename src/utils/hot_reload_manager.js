/**
 * @file src/utils/hot_reload_manager.js
 * @description Manages runtime configuration hot-reloading from KeyValueStore and filesystem.
 * Supports both platform polling and local fs.watch for instant updates.
 * @module utils/hot_reload_manager
 */
import { Actor } from "apify";
import { watch as fsWatch } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { normalizeInput, coerceRuntimeOptions } from "./config.js";
import { APP_CONSTS, ENV_VARS } from "../consts/app.js";
import {
  STORAGE_CONSTS,
  KEY_VALUE_STORES_DIR,
  DEFAULT_KVS_DIR,
  FILE_NAMES,
  KVS_KEYS,
} from "../consts/storage.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { NODE_ERROR_CODES } from "../consts/errors.js";
import { createChildLogger, serializeError } from "./logger.js";

const log = createChildLogger({ component: LOG_COMPONENTS.HOT_RELOAD_MANAGER });

/**
 * @typedef {import("../typedefs.js").CommonError} CommonError
 * @typedef {import("../typedefs.js").ActorInput} ActorInput
 * @typedef {(newConfig: ActorInput, validated: any) => Promise<void>} OnConfigChange
 * @typedef {import("apify").KeyValueStore} ApifyKeyValueStore
 */

export class HotReloadManager {
  /** @type {string} */
  #lastInputStr;
  /** @type {number} */
  #pollIntervalMs;
  /** @type {OnConfigChange} */
  #onConfigChange;

  /** @type {Promise<void> | null} */
  #activePollPromise = null;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  #inputPollInterval;
  /** @type {AbortController | undefined} */
  #fileWatcherAbortController;

  /** @type {ApifyKeyValueStore | null} */
  #store = null;

  /**
   * @param {Object} options
   * @param {Object} options.initialInput - The initial configuration object
   * @param {number} options.pollIntervalMs - How often to poll the KV store
   * @param {OnConfigChange} options.onConfigChange - Callback when config changes
   */
  constructor({ initialInput, pollIntervalMs, onConfigChange }) {
    this.#lastInputStr = JSON.stringify(initialInput);
    this.#pollIntervalMs = pollIntervalMs;
    this.#onConfigChange = onConfigChange;
  }

  /**
   * Initialize resources like the KeyValueStore
   */
  async init() {
    this.#store = await Actor.openKeyValueStore();
  }

  /**
   * Start polling and watching for updates.
   */
  start() {
    if (!this.#store) {
      log.warn(LOG_MESSAGES.HOT_RELOAD_NOT_INIT);
      return;
    }

    // 1. Fallback to interval polling (works on platform and as backup for local)
    // Can be disabled via env var for efficiency in production
    if (process.env[ENV_VARS.DISABLE_HOT_RELOAD] !== "true") {
      this.#inputPollInterval = global.setInterval(() => {
        this.#handleHotReload().catch((err) => {
          log.error(
            { err: serializeError(err) },
            LOG_MESSAGES.HOT_RELOAD_POLL_FAILED,
          );
        });
      }, this.#pollIntervalMs);

      this.#inputPollInterval.unref();
      log.info(
        { intervalMs: this.#pollIntervalMs },
        LOG_MESSAGES.HOT_RELOAD_POLL_ENABLED,
      );
    } else {
      log.info(LOG_MESSAGES.HOT_RELOAD_POLL_DISABLED);
    }

    // 2. Use fs.watch for instant hot-reload in local development
    if (
      !Actor.isAtHome() &&
      process.env[ENV_VARS.DISABLE_HOT_RELOAD] !== "true"
    ) {
      this.#startFsWatch();
    }
  }

  /**
   * Stop all listeners and watchers.
   */
  async stop() {
    if (this.#inputPollInterval) global.clearInterval(this.#inputPollInterval);
    if (this.#fileWatcherAbortController)
      this.#fileWatcherAbortController.abort();
    if (this.#activePollPromise) await this.#activePollPromise;
  }

  async #handleHotReload() {
    if (this.#activePollPromise) return;

    this.#activePollPromise = (async () => {
      try {
        /** @type {ActorInput} */
        const newInput = (await this.#store?.getValue(KVS_KEYS.INPUT)) || {};

        // Normalize input if it's a string (fixes hot-reload from raw KV updates)
        const normalizedInput = normalizeInput(newInput);

        const newInputStr = JSON.stringify(normalizedInput);
        if (newInputStr === this.#lastInputStr) return;

        this.#lastInputStr = newInputStr;
        log.info(LOG_MESSAGES.HOT_RELOAD_DETECTED);

        // Validate/Coerce new config
        const validated = coerceRuntimeOptions(normalizedInput);

        // Notify listener
        await this.#onConfigChange(normalizedInput, validated);

        log.info(LOG_MESSAGES.HOT_RELOAD_COMPLETE);
      } finally {
        this.#activePollPromise = null;
      }
    })();

    await this.#activePollPromise;
  }

  #startFsWatch() {
    const localInputPath = join(
      process.cwd(),
      STORAGE_CONSTS.DEFAULT_STORAGE_DIR,
      KEY_VALUE_STORES_DIR,
      DEFAULT_KVS_DIR,
      FILE_NAMES.CONFIG,
    );

    if (existsSync(localInputPath)) {
      log.info(LOG_MESSAGES.HOT_RELOAD_LOCAL_MODE);

      this.#fileWatcherAbortController = new AbortController();
      let debounceTimer =
        /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);

      // Start watching in background (non-blocking)
      (async () => {
        try {
          const watcher = fsWatch(localInputPath, {
            signal: this.#fileWatcherAbortController?.signal,
          });
          for await (const event of watcher) {
            if (event.eventType === "change" || event.eventType === "rename") {
              if (event.eventType === "rename") {
                log.warn(LOG_MESSAGES.HOT_RELOAD_WATCHER_WARNING);
              }
              // Debounce rapid file changes (editors often write multiple times)
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                this.#handleHotReload().catch((err) => {
                  log.error(
                    { err: serializeError(err) },
                    LOG_MESSAGES.HOT_RELOAD_WATCH_FAILED,
                  );
                });
              }, APP_CONSTS.HOT_RELOAD_DEBOUNCE_MS);
            }
          }
        } catch (err) {
          const error = /** @type {CommonError} */ (err);
          if (error.name !== NODE_ERROR_CODES.ABORT_ERROR) {
            log.error(
              { err: serializeError(error) },
              LOG_MESSAGES.HOT_RELOAD_WATCH_ERROR,
            );
          }
        }
      })();
    }
  }
}
