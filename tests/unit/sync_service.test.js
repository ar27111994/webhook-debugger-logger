import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType } from "../setup/helpers/test-utils.js";

// 1. Setup Common Mocks
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({
  logger: true,
  apify: true,
  db: true,
  consts: true,
  events: true,
  repositories: true,
});

import {
  duckDbMock,
  logRepositoryMock,
  eventsMock,
  createDatasetMock,
  loggerMock,
  constsMock,
} from "../setup/helpers/shared-mocks.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";

const { appEvents } = eventsMock; // Destructure for test usage

// Mock dependencies
/** @type {Promise<void>} */
let pendingSyncPromise;
const mockLimiter = {
  schedule: jest.fn(),
  stop: jest.fn(),
};

jest.unstable_mockModule("bottleneck", () => ({
  default: jest.fn(() => mockLimiter),
}));

// Import class under test
const { SyncService } = await import("../../src/services/SyncService.js");

/**
 * @typedef {import("../../src/services/SyncService.js").SyncService} SyncService
 * @typedef {import("apify").Dataset} Dataset
 */

const MOCK_DATASET_SIZE = 100;
const BATCH_SIZE = 10;
const RECURSIVE_CALLS = 2;

describe("SyncService", () => {
  useMockCleanup();

  /** @type {SyncService} */
  let service;
  /** @type {jest.Mocked<Dataset>} */
  let mockDataset;

  beforeEach(() => {
    service = new SyncService();
    pendingSyncPromise = Promise.resolve(); // Reset

    // Explicit resets
    duckDbMock.executeQuery.mockReset();
    logRepositoryMock.insertLog.mockReset();
    logRepositoryMock.batchInsertLogs.mockReset();
    logRepositoryMock.batchInsertLogs.mockReset();
    mockLimiter.schedule.mockReset();
    mockLimiter.schedule.mockImplementation(
      /**
       * @param {() => Promise<void>} fn
       * @returns {Promise<void>}
       */
      (fn) => {
        const result = fn();
        pendingSyncPromise = result;
        return result;
      },
    );

    mockDataset = assertType(
      createDatasetMock(new Array(MOCK_DATASET_SIZE).fill({}), {
        autoRegister: true,
      }),
    );

    // Default DB state: no offset
    duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: null }]);
  });

  describe("Lifecycle", () => {
    test("should start and subscribe to events", async () => {
      await service.start();
      expect(appEvents.on).toHaveBeenCalledWith(
        "log:received",
        expect.any(Function),
      );
      expect(loggerMock.info).toHaveBeenCalledWith(LOG_MESSAGES.SYNC_START);
    });

    test("should not start if already running", async () => {
      await service.start();
      appEvents.on.mockClear();
      await service.start();
      expect(appEvents.on).not.toHaveBeenCalled();
    });

    test("should stop and unsubscribe", async () => {
      await service.start();
      service.stop();
      expect(appEvents.off).toHaveBeenCalledWith(
        "log:received",
        expect.any(Function),
      );
      expect(mockLimiter.stop).toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(LOG_MESSAGES.SYNC_STOP);
    });
  });

  describe("Metrics", () => {
    test("should return initial metrics", () => {
      const metrics = service.getMetrics();
      expect(metrics).toEqual({
        syncCount: 0,
        errorCount: 0,
        itemsSynced: 0,
        lastSyncTime: undefined,
        lastErrorTime: undefined,
        isRunning: false,
      });
    });
  });

  describe("Real-time Log Handling", () => {
    test("should insert log immediately when received", async () => {
      await service.start();

      // Simulate event
      const handler = appEvents.on.mock.calls[0][1];
      const payload = { id: "log_1" };

      await handler(payload);

      expect(logRepositoryMock.insertLog).toHaveBeenCalledWith(
        assertType(payload),
      );
      // Should also trigger sync (schedule called)
      expect(mockLimiter.schedule).toHaveBeenCalled();
    });

    test("should log error if immediate insert fails", async () => {
      await service.start();
      logRepositoryMock.insertLog.mockRejectedValue(new Error("DB Error"));

      const handler = appEvents.on.mock.calls[0][1];
      await handler({ id: "log_1" });

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        LOG_MESSAGES.REALTIME_INSERT_FAILED,
      );
    });

    test("should ignore events if stopped", async () => {
      // Manually get handler then stop
      await service.start();
      const handler = appEvents.on.mock.calls[0][1];
      service.stop();
      logRepositoryMock.insertLog.mockClear();

      await handler({ id: "log_1" });
      expect(logRepositoryMock.insertLog).not.toHaveBeenCalled();
    });
  });

  describe("Synchronization Logic", () => {
    test("should fetch and sync new items from Dataset", async () => {
      // Setup
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 9 }]); // Next is 10
      mockDataset.getInfo.mockResolvedValue(assertType({ itemCount: 20 }));
      mockDataset.getData.mockResolvedValue(
        assertType({
          items: [{ id: "log_10" }, { id: "log_11" }], // 2 items
        }),
      );

      await service.start(); // triggers initial sync
      await pendingSyncPromise; // Wait for it

      // Verify DB Query for offset
      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("SELECT MAX(source_offset)"),
      );

      // Verify Dataset Fetch
      expect(mockDataset.getData).toHaveBeenCalledWith({
        offset: 10,
        limit: 10,
      });

      // Verify Batch Insert
      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalledWith([
        expect.objectContaining({ id: "log_10", sourceOffset: 10 }),
        expect.objectContaining({ id: "log_11", sourceOffset: 11 }),
      ]);

      // Verify Verify Metrics
      const metrics = service.getMetrics();
      expect(metrics.syncCount).toBe(1);
      expect(metrics.itemsSynced).toBe(2); // Only 2 items in response
    });

    test("should handle empty dataset or up-to-date state", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 19 }]); // Next 20
      mockDataset.getInfo.mockResolvedValue(assertType({ itemCount: 20 })); // No new items

      await service.start();
      await pendingSyncPromise;

      expect(mockDataset.getData).not.toHaveBeenCalled();
    });

    test("should handle batch insert errors", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: null }]);
      mockDataset.getInfo.mockResolvedValue(assertType({ itemCount: 10 }));
      mockDataset.getData.mockResolvedValue(
        assertType({ items: [{ id: "log_0" }] }),
      );

      logRepositoryMock.batchInsertLogs.mockRejectedValue(
        new Error("Insert Failed"),
      );

      await service.start();
      await pendingSyncPromise;

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        LOG_MESSAGES.SYNC_ERROR_GENERAL,
      );

      const metrics = service.getMetrics();
      expect(metrics.errorCount).toBe(1);
    });

    test("should trigger recursive sync if batch limit reached", async () => {
      // Verify constant execution and values
      expect(constsMock.SYNC_BATCH_SIZE).toBe(BATCH_SIZE); // Sanity check

      const batch = Array(BATCH_SIZE)
        .fill(null)
        .map((_, i) => ({ id: `log_${i}` }));

      // Mock chain directly on the instance we created in beforeEach
      mockDataset.getData.mockReset(); // Clear previous
      mockDataset.getData
        .mockResolvedValueOnce(
          assertType({ items: batch, count: BATCH_SIZE, limit: BATCH_SIZE }),
        ) // Call 1 (Start) -> returns batch
        .mockResolvedValueOnce(
          assertType({ items: [], count: 0, limit: BATCH_SIZE }),
        ); // Call 2 (Recursive) -> returns empty

      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: null }]);

      await service.start();
      await pendingSyncPromise; // Wait for first batch
      await pendingSyncPromise; // Wait for recursive batch

      // Call 1: start() -> triggerSync() -> schedule() -> syncLogs() -> getData() (10 items) -> triggerSync() -> schedule()
      // Call 2: syncLogs() -> getData() (0 items) -> finish.

      expect(mockLimiter.schedule).toHaveBeenCalledTimes(RECURSIVE_CALLS);
      expect(mockDataset.getData).toHaveBeenCalledTimes(RECURSIVE_CALLS);
      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalledTimes(1);
    });

    test("should map items and generate UUIDs if missing", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: null }]);
      mockDataset.getInfo.mockResolvedValue(assertType({ itemCount: 1 }));
      mockDataset.getData.mockResolvedValue(
        assertType({ items: [{ method: "GET" }] }),
      );

      await service.start();
      await pendingSyncPromise;

      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalledWith([
        expect.objectContaining({
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          method: "GET",
          sourceOffset: 0,
        }),
      ]);
    });

    test("should invalidate cache and update error metrics on failure", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 10 }]);
      mockDataset.getInfo.mockRejectedValue(new Error("Network Error"));

      // Trigger sync via start
      await service.start();
      await pendingSyncPromise;

      const metrics = service.getMetrics();
      expect(metrics.errorCount).toBe(1);
      expect(metrics.lastErrorTime).toBeDefined();

      // Verify cache invalidation by checking if next sync queries DB again
      mockDataset.getInfo.mockResolvedValue(assertType({ itemCount: 0 }));
      duckDbMock.executeQuery.mockClear();

      // Trigger another sync via event
      const handler = appEvents.on.mock.calls[0][1];
      await handler({ id: "log_trigger" });
      await pendingSyncPromise;

      expect(duckDbMock.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("SELECT MAX(source_offset)"),
      );
    });

    test("should handle limiter schedule errors", async () => {
      await service.start();
      mockLimiter.schedule.mockRejectedValue(new Error("Limiter Error"));

      const handler = appEvents.on.mock.calls[0][1];
      await handler({ id: "log_trigger" });

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        LOG_MESSAGES.SYNC_SCHEDULE_ERROR,
      );
    });

    test("should suppress BOTTLENECK_STOPPED errors during shutdown", async () => {
      await service.start();
      const stoppedError = new Error("This limiter has been stopped");
      mockLimiter.schedule.mockRejectedValue(stoppedError);

      const handler = appEvents.on.mock.calls[0][1];
      await handler({ id: "log_shutdown" });

      expect(loggerMock.error).not.toHaveBeenCalled();
    });
  });
});
