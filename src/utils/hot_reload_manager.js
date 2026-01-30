/**
 * @file src/utils/hot_reload_manager.js
 * @description Manages runtime configuration hot-reloading from KeyValueStore and filesystem.
 * Supports both platform polling and local fs.watch for instant updates.
 */
import { Actor } from "apify";
import { watch as fsWatch } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { normalizeInput, coerceRuntimeOptions } from "./config.js";
import { HOT_RELOAD_DEBOUNCE_MS } from "../consts.js";
import { createChildLogger, serializeError } from "./logger.js";

const log = createChildLogger({ component: "HotReloadManager" });

/**
 * @typedef {import("../typedefs.js").CommonError} CommonError
 * @typedef {(newConfig: any, validated: any) => Promise<void>} OnConfigChange
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

  /** @type {any} */
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
    // 1. Fallback to interval polling (works on platform and as backup for local)
    // Can be disabled via env var for efficiency in production
    if (process.env.DISABLE_HOT_RELOAD !== "true") {
      this.#inputPollInterval = global.setInterval(() => {
        this.#handleHotReload().catch((err) => {
          log.error({ err: serializeError(err) }, "Polling hot-reload failed");
        });
      }, this.#pollIntervalMs);

      this.#inputPollInterval.unref();
      log.info(
        { intervalMs: this.#pollIntervalMs },
        "Hot-reload polling enabled",
      );
    } else {
      log.info("Hot-reload polling disabled via DISABLE_HOT_RELOAD");
    }

    // 2. Use fs.watch for instant hot-reload in local development
    if (!Actor.isAtHome()) {
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
        if (!this.#store) return; // Should not happen if init() is called

        const newInput = /** @type {Record<string, any> | null} */ (
          await this.#store.getValue("INPUT")
        );
        if (!newInput) return;

        // Normalize input if it's a string (fixes hot-reload from raw KV updates)
        const normalizedInput = normalizeInput(newInput);

        const newInputStr = JSON.stringify(normalizedInput);
        if (newInputStr === this.#lastInputStr) return;

        this.#lastInputStr = newInputStr;
        log.info("Detected input update, applying new settings");

        // Validate/Coerce new config
        const validated = coerceRuntimeOptions(normalizedInput);

        // Notify listener
        await this.#onConfigChange(normalizedInput, validated);

        log.info("Hot-reload complete, new settings active");
      } catch (err) {
        log.error({ err: serializeError(err) }, "Failed to apply new settings");
      } finally {
        this.#activePollPromise = null;
      }
    })();

    await this.#activePollPromise;
  }

  #startFsWatch() {
    const localInputPath = join(
      process.cwd(),
      "storage",
      "key_value_stores",
      "default",
      "INPUT.json",
    );

    if (existsSync(localInputPath)) {
      log.info("Local mode detected, using fs.watch for instant hot-reload");

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
            if (event.eventType === "change") {
              // Debounce rapid file changes (editors often write multiple times)
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                this.#handleHotReload().catch((err) => {
                  log.error(
                    { err: serializeError(err) },
                    "fs.watch hot-reload failed",
                  );
                });
              }, HOT_RELOAD_DEBOUNCE_MS);
            }
          }
        } catch (err) {
          const error = /** @type {CommonError} */ (err);
          if (error.name !== "AbortError") {
            log.error({ err: serializeError(error) }, "fs.watch failed");
          }
        }
      })();
    }
  }
}
