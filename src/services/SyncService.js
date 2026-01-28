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

/**
 * @typedef {import('../typedefs.js').LogEntry} LogEntry
 * @typedef {import('../typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../utils/events.js').AppEvents} AppEvents
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
      console.error("❌ Real-time insert failed:", err);
    }
  }

  /**
   * Start the synchronization service (Event-Driven)
   */
  async start() {
    if (this.#isRunning) return;
    this.#isRunning = true;

    console.log("🔄 SyncService: Starting (Event-Driven)...");

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
    console.log("⏹️ SyncService: Stopped listening");
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
        console.error("❌ Sync scheduling error:", err);
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

      console.log(
        `📥 Syncing ${items.length} items starting at offset ${nextOffset}...`,
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

      // 6. Update Cache
      this.#cachedMaxOffset = nextOffset + items.length - 1;

      // If we fetched a full batch, schedule another run immediately
      if (items.length === limit) {
        this.#triggerSync();
      }
    } catch (err) {
      console.error("❌ Sync Error:", err);
      // Invalidate cache on error
      this.#cachedMaxOffset = null;
    }
  }
}
