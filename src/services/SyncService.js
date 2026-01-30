/**
 * @file src/services/SyncService.js
 * @description Background service to sync Apify Dataset items into DuckDB Read Model
 */
import { Actor } from "apify";
import {
  SYNC_BATCH_SIZE,
  SYNC_MAX_CONCURRENT,
  SYNC_MIN_TIME_MS,
} from "../consts.js";
import Bottleneck from "bottleneck";
import { executeQuery } from "../db/duckdb.js";
import { logRepository } from "../repositories/LogRepository.js";
import { appEvents } from "../utils/events.js";
import crypto from "crypto";
import { createChildLogger, serializeError } from "../utils/logger.js";

const log = createChildLogger({ component: "SyncService" });

/**
 * @typedef {import('../typedefs.js').LogEntry} LogEntry
 * @typedef {import('../typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../utils/events.js').AppEvents} AppEvents
 */

/**
 * @typedef {Object} SyncMetrics
 * @property {number} syncCount
 * @property {number} errorCount
 * @property {number} itemsSynced
 * @property {string} [lastSyncTime]
 * @property {string} [lastErrorTime]
 * @property {boolean} isRunning
 */

// Export singleton (optional) or just the class.
// Since main.js initializes it, exporting class is better.
export class SyncService {
  /** @type {Bottleneck} */
  #limiter;
  /** @type {number | null} */
  #cachedMaxOffset;
  /** @type {boolean} */
  #isRunning;
  /** @type {AppEvents['logReceived'] | null} */
  #boundOnLogReceived = null;

  // Metrics
  /** @type {number} */
  #syncCount = 0;
  /** @type {number} */
  #errorCount = 0;
  /** @type {number} */
  #itemsSynced = 0;
  /** @type {Date | null} */
  #lastSyncTime = null;
  /** @type {Date | null} */
  #lastErrorTime = null;

  constructor() {
    // Rate limit sync operations
    this.#limiter = new Bottleneck({
      maxConcurrent: SYNC_MAX_CONCURRENT,
      minTime: SYNC_MIN_TIME_MS,
    });

    this.#cachedMaxOffset = null;
    this.#isRunning = false;

    // Bind methods for event listener
    this.#boundOnLogReceived = this.#onLogReceived.bind(this);
  }

  /**
   * Returns current sync metrics for monitoring.
   * @returns {SyncMetrics}
   */
  getMetrics() {
    return {
      syncCount: this.#syncCount,
      errorCount: this.#errorCount,
      itemsSynced: this.#itemsSynced,
      lastSyncTime: this.#lastSyncTime?.toISOString(),
      lastErrorTime: this.#lastErrorTime?.toISOString(),
      isRunning: this.#isRunning,
    };
  }

  /**
   * Handle new log events
   * @param {WebhookEvent} payload
   */
  async #onLogReceived(payload) {
    if (!this.#isRunning) return;

    try {
      // 1. Instant insert for real-time view (offset=null)
      await logRepository.insertLog(payload);

      // 2. Schedule sync
      this.#triggerSync();
    } catch (err) {
      log.error({ err: serializeError(err) }, "Real-time insert failed");
    }
  }

  /**
   * Start the synchronization service (Event-Driven)
   */
  async start() {
    if (this.#isRunning) return;
    this.#isRunning = true;

    log.info("SyncService starting (Event-Driven)");

    // Initial sync to catch up on any missed data (e.g. restart)
    this.#triggerSync();

    // Listen for new logs
    if (this.#boundOnLogReceived) {
      appEvents.on("log:received", this.#boundOnLogReceived);
    }
  }

  /**
   * Stop the synchronization service
   */
  stop() {
    log.info("SyncService stopped");
    this.#isRunning = false;
    if (this.#boundOnLogReceived) {
      appEvents.off("log:received", this.#boundOnLogReceived);
    }
    this.#limiter.stop({ dropWaitingJobs: true });
  }

  /**
   * Trigger synchronization with concurrency control via Bottleneck
   */
  #triggerSync() {
    if (!this.#isRunning) return;

    // schedule returns a promise but we don't await it here to avoid blocking event loop
    this.#limiter
      .schedule(() => this.#syncLogs())
      .catch((err) => {
        // Suppress expected error when service is stopping
        if (err?.message?.includes("has been stopped")) return;
        log.error({ err: serializeError(err) }, "Sync scheduling error");
      });
  }

  /**
   * Get the next offset to fetch.
   * Uses in-memory cache if available, otherwise queries DuckDB.
   * @returns {Promise<number>}
   */
  async #getNextOffset() {
    if (this.#cachedMaxOffset !== null) {
      return this.#cachedMaxOffset + 1;
    }

    const rows = await executeQuery(
      "SELECT MAX(source_offset) as maxOffset FROM logs",
    );
    const maxOffsetVal = rows[0]?.maxOffset;
    const lastOffset =
      maxOffsetVal !== null && maxOffsetVal !== undefined
        ? Number(maxOffsetVal)
        : -1;

    this.#cachedMaxOffset = lastOffset;
    return lastOffset + 1;
  }

  /**
   * Syncs new items from Dataset to DuckDB
   */
  async #syncLogs() {
    try {
      // 1. Determine start offset
      const nextOffset = await this.#getNextOffset();

      // 2. Check Dataset Info
      const dataset = await Actor.openDataset();
      const info = await dataset.getInfo();

      if (!info || info.itemCount <= nextOffset) {
        return; // Nothing new
      }

      const limit = SYNC_BATCH_SIZE; // Batch size

      // 3. Fetch Data
      const { items } = await dataset.getData({
        offset: nextOffset,
        limit: limit,
      });

      if (items.length === 0) return;

      log.info(
        { count: items.length, offset: nextOffset },
        "Syncing items from Dataset",
      );

      // 4. Batch Processing
      const logsToInsert = items.map((item, i) => {
        const offset = nextOffset + i;
        // Ensure ID presence
        const mutableItem = /** @type {LogEntry} */ (item);
        if (!mutableItem.id) mutableItem.id = crypto.randomUUID();

        return {
          ...mutableItem,
          sourceOffset: offset,
        };
      });

      // 5. Batch Insert into DuckDB
      await logRepository.batchInsertLogs(logsToInsert);

      // 6. Update Cache & Metrics
      this.#cachedMaxOffset = nextOffset + items.length - 1;
      this.#syncCount++;
      this.#itemsSynced += items.length;
      this.#lastSyncTime = new Date();

      // If we fetched a full batch, schedule another run immediately
      if (items.length === limit) {
        this.#triggerSync();
      }
    } catch (err) {
      log.error({ err: serializeError(err) }, "Sync error");
      // Invalidate cache on error
      this.#cachedMaxOffset = null;
      this.#errorCount++;
      this.#lastErrorTime = new Date();
    }
  }
}
