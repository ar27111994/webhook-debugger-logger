import { Actor } from "apify";
import { watch as fsWatch } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { normalizeInput, coerceRuntimeOptions } from "./config.js";

/**
 * @typedef {import("../typedefs.js").CommonError} CommonError
 */

export class HotReloadManager {
  /**
   * @param {Object} options
   * @param {Object} options.initialInput - The initial configuration object
   * @param {number} options.pollIntervalMs - How often to poll the KV store
   * @param {Function} options.onConfigChange - Callback when config changes: (newConfig) => Promise<void>
   */
  constructor({ initialInput, pollIntervalMs, onConfigChange }) {
    this.lastInputStr = JSON.stringify(initialInput);
    this.pollIntervalMs = pollIntervalMs;
    this.onConfigChange = onConfigChange;

    /** @type {Promise<void> | null} */
    this.activePollPromise = null;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    this.inputPollInterval = undefined;
    /** @type {AbortController | undefined} */
    this.fileWatcherAbortController = undefined;

    this.store = null;
  }

  /**
   * Initialize resources like the KeyValueStore
   */
  async init() {
    this.store = await Actor.openKeyValueStore();
  }

  /**
   * Start polling and watching for updates.
   */
  start() {
    // 1. Fallback to interval polling (works on platform and as backup for local)
    this.inputPollInterval = setInterval(() => {
      this._handleHotReload().catch((err) => {
        console.error("[SYSTEM-ERROR] Polling hot-reload failed:", err.message);
      });
    }, this.pollIntervalMs);

    if (this.inputPollInterval.unref) this.inputPollInterval.unref();

    // 2. Use fs.watch for instant hot-reload in local development
    if (!Actor.isAtHome()) {
      this._startFsWatch();
    }
  }

  /**
   * Stop all listeners and watchers.
   */
  async stop() {
    if (this.inputPollInterval) clearInterval(this.inputPollInterval);
    if (this.fileWatcherAbortController)
      this.fileWatcherAbortController.abort();
    if (this.activePollPromise) await this.activePollPromise;
  }

  async _handleHotReload() {
    if (this.activePollPromise) return;

    this.activePollPromise = (async () => {
      try {
        if (!this.store) return; // Should not happen if init() is called

        const newInput = /** @type {Record<string, any> | null} */ (
          await this.store.getValue("INPUT")
        );
        if (!newInput) return;

        // Normalize input if it's a string (fixes hot-reload from raw KV updates)
        const normalizedInput = normalizeInput(newInput);

        const newInputStr = JSON.stringify(normalizedInput);
        if (newInputStr === this.lastInputStr) return;

        this.lastInputStr = newInputStr;
        console.log("[SYSTEM] Detected input update! Applying new settings...");

        // Validate/Coerce new config
        const validated = coerceRuntimeOptions(normalizedInput);

        // Notify listener
        if (this.onConfigChange) {
          await this.onConfigChange(normalizedInput, validated);
        }

        console.log("[SYSTEM] Hot-reload complete. New settings are active.");
      } catch (err) {
        console.error(
          "[SYSTEM-ERROR] Failed to apply new settings:",
          /** @type {Error} */ (err).message,
        );
      } finally {
        this.activePollPromise = null;
      }
    })();

    await this.activePollPromise;
  }

  _startFsWatch() {
    const localInputPath = join(
      process.cwd(),
      "storage",
      "key_value_stores",
      "default",
      "INPUT.json",
    );

    if (existsSync(localInputPath)) {
      console.log(
        "[SYSTEM] Local mode detected. Using fs.watch for instant hot-reload.",
      );

      this.fileWatcherAbortController = new AbortController();
      let debounceTimer =
        /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);

      // Start watching in background (non-blocking)
      (async () => {
        try {
          const watcher = fsWatch(localInputPath, {
            signal: this.fileWatcherAbortController?.signal,
          });
          for await (const event of watcher) {
            if (event.eventType === "change") {
              // Debounce rapid file changes (editors often write multiple times)
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                this._handleHotReload().catch((err) => {
                  console.error(
                    "[SYSTEM-ERROR] fs.watch hot-reload failed:",
                    /** @type {Error} */ (err).message,
                  );
                });
              }, 100);
            }
          }
        } catch (err) {
          const error = /** @type {CommonError} */ (err);
          if (error.name !== "AbortError") {
            console.error("[SYSTEM-ERROR] fs.watch failed:", error.message);
          }
        }
      })();
    }
  }
}
