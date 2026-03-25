/**
 * @file tests/unit/services/sync_service.test.js
 * @description Unit tests for SyncService.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import {
  loggerMock,
  apifyMock,
  datasetMock,
  keyValueStoreMock,
  logRepositoryMock,
  eventsMock,
  duckDbMock,
  constsMock,
} from "../../setup/helpers/shared-mocks.js";
import {
  assertType,
  sleep,
  waitForCondition,
} from "../../setup/helpers/test-utils.js";
import { SYNC_MIN_TIME_MS } from "../../../src/consts/database.js";
import Bottleneck from "bottleneck";
import { ERROR_MESSAGES } from "../../../src/consts/errors.js";
import { LOG_MESSAGES } from "../../../src/consts/messages.js";

// Setup mocks MUST happen before importing any source code
await setupCommonMocks({
  logger: true,
  apify: true,
  events: true,
  repositories: true,
  db: true,
  consts: true,
});

// Use dynamic import for the service
const { SyncService } = await import("../../../src/services/SyncService.js");

describe("SyncService", () => {
  // Wait for bottleneck schedule and potential internal awaits
  const SYNC_OFFSET = 200;
  const WAIT_MS = SYNC_MIN_TIME_MS + SYNC_OFFSET;
  /** @type {InstanceType<typeof SyncService>} */
  let syncService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Reset mock implementations for dataset and repository mocks
    jest
      .mocked(datasetMock.getInfo)
      .mockResolvedValue(assertType({ itemCount: 0 }));
    jest
      .mocked(datasetMock.getData)
      .mockResolvedValue(assertType({ items: [] }));
    duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
    logRepositoryMock.batchInsertLogs.mockResolvedValue();
    logRepositoryMock.insertLog.mockResolvedValue();

    // Ensure SyncService gets the same datasetMock we use in tests
    apifyMock.Actor?.openDataset.mockResolvedValue(assertType(datasetMock));
    apifyMock.Actor?.openKeyValueStore.mockResolvedValue(keyValueStoreMock);

    syncService = new SyncService();
  });

  afterEach(async () => {
    if (syncService) {
      await syncService.stop();
    }
  });

  describe("Initialization", () => {
    it("should initialize with default state", () => {
      const metrics = syncService.getMetrics();
      expect(metrics.isRunning).toBe(false);
      expect(metrics.syncCount).toBe(0);
    });
  });

  describe("start/stop", () => {
    it("should start service and listen for events", async () => {
      const maxOffset = 5;
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValueOnce(assertType({ itemCount: 10 }));
      const mockItems = [{ id: "l6", message: "m6" }];
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValueOnce(assertType({ items: mockItems }));

      await syncService.start();

      expect(syncService.getMetrics().isRunning).toBe(true);
      expect(eventsMock.appEvents.on).toHaveBeenCalledWith(
        eventsMock.EVENT_NAMES.LOG_RECEIVED,
        expect.any(Function),
      );

      await waitForCondition(
        () => logRepositoryMock.batchInsertLogs.mock.calls.length > 0,
        WAIT_MS,
      );
      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalled();
    });

    it("should stop service and cleanup", async () => {
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValueOnce(assertType({ itemCount: 0 }));
      await syncService.start();
      await syncService.stop();

      expect(syncService.getMetrics().isRunning).toBe(false);
      expect(eventsMock.appEvents.off).toHaveBeenCalledWith(
        eventsMock.EVENT_NAMES.LOG_RECEIVED,
        expect.any(Function),
      );

      // Double stop should be safe (idempotent)
      await expect(syncService.stop()).resolves.not.toThrow();
    });
  });

  describe("Sync Logic", () => {
    it("should sync items from dataset", async () => {
      // Setup all mocks BEFORE starting
      const maxOffset = 5;
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 10 }));

      const mockItems = [
        { id: "l6", message: "m6" },
        { id: "l7", message: "m7" },
      ];
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValue(assertType({ items: mockItems }));

      await syncService.start();
      await waitForCondition(
        () => logRepositoryMock.batchInsertLogs.mock.calls.length > 0,
        WAIT_MS,
      );

      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalled();
      const call = logRepositoryMock.batchInsertLogs.mock.calls[0][0];
      const expectedCalls = 2;
      expect(call).toHaveLength(expectedCalls);
      // Source offset should start from maxOffset + 1
      expect(call[0].sourceOffset).toBe(maxOffset + 1);
      expect(call[1].sourceOffset).toBe(maxOffset + 1 + 1);

      const metrics = syncService.getMetrics();
      expect(metrics.itemsSynced).toBe(expectedCalls);
      expect(metrics.syncCount).toBe(1);
    });

    it("should handle empty offset (initial sync)", async () => {
      const id = "10";
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: null }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 1 }));
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValue(assertType({ items: [{ id }] }));

      await syncService.start();
      await waitForCondition(
        () => logRepositoryMock.batchInsertLogs.mock.calls.length > 0,
        WAIT_MS,
      );

      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalledWith([
        expect.objectContaining({ id, sourceOffset: 0 }),
      ]);
    });

    it("should fallback to offset 0 when maxOffset from DB is not finite", async () => {
      const id = "offset-fallback";
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: "NaN" }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 1 }));
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValue(assertType({ items: [{ id }] }));

      await syncService.start();
      await waitForCondition(
        () => logRepositoryMock.batchInsertLogs.mock.calls.length > 0,
        WAIT_MS,
      );

      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalledWith([
        expect.objectContaining({ id, sourceOffset: 0 }),
      ]);
    });

    it("should handle missing dataset info", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest.mocked(datasetMock.getInfo).mockResolvedValue(assertType(null));

      await syncService.start();
      await sleep(WAIT_MS);

      expect(datasetMock.getData).not.toHaveBeenCalled();
    });

    it("should skip sync when dataset itemCount is malformed", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: "not-a-number" }));

      await syncService.start();
      await sleep(WAIT_MS);

      expect(datasetMock.getData).not.toHaveBeenCalled();
      expect(logRepositoryMock.batchInsertLogs).not.toHaveBeenCalled();
    });

    it("should handle sync errors", async () => {
      // Use mockResolvedValue with local override
      duckDbMock.executeQuery.mockImplementationOnce(() =>
        Promise.reject(new Error("DB Error")),
      );

      await syncService.start();
      await sleep(WAIT_MS);

      const metrics = syncService.getMetrics();
      expect(metrics.errorCount).toBe(1);
      expect(loggerMock.error).toHaveBeenCalled();
    });

    it("should generate missing IDs", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 10 }));
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValue(assertType({ items: [{ url: "test.com" }] }));

      await syncService.start();
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalled();
      const call = logRepositoryMock.batchInsertLogs.mock.calls[0][0];
      expect(call[0].id).toBeDefined();
      expect(call[0].id).toMatch(/^[0-9a-f-]+$/); // UUID format
    });

    it("should trigger recursive sync if batch is full", async () => {
      const limit = constsMock.SYNC_BATCH_SIZE;
      const itemCount = 5;

      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: limit + itemCount }));

      // First batch full
      const fullBatch = Array.from({ length: limit }, (_, i) => ({
        id: `l${i}`,
      }));
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValueOnce(assertType({ items: fullBatch }));

      // Second batch partial
      const partialBatch = [{ id: "last" }];
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValueOnce(assertType({ items: partialBatch }));

      await syncService.start();
      const EXPECTED_BATCH_INSERT_CALLS = 2;
      await waitForCondition(
        () =>
          logRepositoryMock.batchInsertLogs.mock.calls.length >=
          EXPECTED_BATCH_INSERT_CALLS,
        WAIT_MS + WAIT_MS,
      );

      // Should call batchInsert twice
      const expectedCalls = EXPECTED_BATCH_INSERT_CALLS;
      expect(logRepositoryMock.batchInsertLogs).toHaveBeenCalledTimes(
        expectedCalls,
      );
      expect(syncService.getMetrics().syncCount).toBe(expectedCalls);
    });
  });

  describe("Event Handlers", () => {
    it("should handle LOG_RECEIVED event", async () => {
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 0 }));
      await syncService.start();

      const handler = eventsMock.appEvents.on.mock.calls.find(
        (c) => c[0] === eventsMock.EVENT_NAMES.LOG_RECEIVED,
      )?.[1];
      expect(handler).toBeDefined();

      const payload = { id: "evt-1" };
      await handler?.(payload);

      expect(logRepositoryMock.insertLog).toHaveBeenCalledWith(payload);
    });

    it("should ignore malformed LOG_RECEIVED payload", async () => {
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 0 }));
      await syncService.start();

      const handler = eventsMock.appEvents.on.mock.calls.find(
        (c) => c[0] === eventsMock.EVENT_NAMES.LOG_RECEIVED,
      )?.[1];
      expect(handler).toBeDefined();

      await handler?.(null);
      await handler?.(undefined);
      await handler?.("invalid");

      expect(logRepositoryMock.insertLog).not.toHaveBeenCalled();
    });

    it("should log error if real-time insert fails", async () => {
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 0 }));
      await syncService.start();
      const handler = eventsMock.appEvents.on.mock.calls.find(
        (c) => c[0] === eventsMock.EVENT_NAMES.LOG_RECEIVED,
      )?.[1];
      expect(handler).toBeDefined();

      logRepositoryMock.insertLog.mockRejectedValueOnce(
        new Error("Insert Failed"),
      );
      await handler?.({ id: "fail" });

      expect(loggerMock.error).toHaveBeenCalled();
    });
  });

  describe("Edge Cases & Coverage", () => {
    it("should use cached max offset", async () => {
      const itemCount = 10;
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 0 }));

      duckDbMock.executeQuery.mockResolvedValueOnce([{ maxOffset: itemCount }]);
      await syncService.start();
      await sleep(WAIT_MS);

      // Trigger another sync via event
      const handler = eventsMock.appEvents.on.mock.calls.find(
        (c) => c[0] === eventsMock.EVENT_NAMES.LOG_RECEIVED,
      )?.[1];
      expect(handler).toBeDefined();

      duckDbMock.executeQuery.mockClear();
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount }));
      await handler?.({ id: "evt-cached" });

      await sleep(WAIT_MS);

      // Should NOT call executeQuery for offset because it's in #cachedMaxOffset
      expect(duckDbMock.executeQuery).not.toHaveBeenCalled();
    });

    it("should handle empty items array from dataset", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 10 }));
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValueOnce(assertType({ items: [] })); // Edge case: info says new items, but none returned

      await syncService.start();
      await sleep(WAIT_MS);

      expect(logRepositoryMock.batchInsertLogs).not.toHaveBeenCalled();
    });

    it("should handle malformed dataset items response", async () => {
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 10 }));
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValue(assertType({ items: null }));

      await syncService.start();
      await sleep(WAIT_MS);

      expect(logRepositoryMock.batchInsertLogs).not.toHaveBeenCalled();
    });

    it("should handle sync when isRunning is false (noop)", async () => {
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 0 }));
      await syncService.start();

      // Get the handler BEFORE stopping
      /** @type {function(object): Promise<void>} */
      const handler = assertType(
        eventsMock.appEvents.on.mock.calls.find(
          (c) => c[0] === eventsMock.EVENT_NAMES.LOG_RECEIVED,
        )?.[1],
      );
      expect(handler).toBeDefined();

      await syncService.stop();

      // Verify isRunning is false
      const metrics = syncService.getMetrics();
      expect(metrics.isRunning).toBe(false);

      logRepositoryMock.insertLog.mockClear();
      logRepositoryMock.batchInsertLogs.mockClear();

      // Call handler after stop - should be no-op due to isRunning = false
      await handler?.({ id: "late-event" });

      // Handler should still work for real-time events IF the listener wasn't removed.
      // But SyncService.stop REMOVES the listener.
      expect(eventsMock.appEvents.off).toHaveBeenCalled();
      expect(logRepositoryMock.batchInsertLogs).not.toHaveBeenCalled();
    });

    it("should handle start when already running", async () => {
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 0 }));
      await syncService.start();

      const metricsBefore = syncService.getMetrics();
      expect(metricsBefore.isRunning).toBe(true);
      await syncService.start(); // Second start
      const metricsAfter = syncService.getMetrics();

      expect(metricsAfter.isRunning).toBe(true);
      // Shouldn't double register listeners etc.
      expect(eventsMock.appEvents.on).toHaveBeenCalledTimes(1);
    });

    it("should handle BOTTLENECK_STOPPED error when stopping during sync", async () => {
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 10 }));
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest
        .mocked(datasetMock.getData)
        .mockResolvedValue(assertType({ items: [{ id: "test" }] }));

      await syncService.start();

      // Wait just long enough for sync to be scheduled in bottleneck, then stop immediately
      const timeout = 10;
      await sleep(timeout);
      await syncService.stop();

      // Should NOT log an error for BOTTLENECK_STOPPED - it should be suppressed
      expect(loggerMock.error).not.toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            message: expect.stringContaining("has been stopped"),
          }),
        }),
      );
    });

    it("should suppress BOTTLENECK_STOPPED errors thrown by scheduler catch path", async () => {
      const scheduleSpy = jest
        .spyOn(Bottleneck.prototype, "schedule")
        .mockImplementation(() =>
          Promise.reject(new Error(ERROR_MESSAGES.BOTTLENECK_STOPPED)),
        );

      await syncService.start();
      await sleep(WAIT_MS);

      expect(loggerMock.error).not.toHaveBeenCalledWith(
        expect.any(Object),
        LOG_MESSAGES.SYNC_SCHEDULE_ERROR,
      );

      scheduleSpy.mockRestore();
    });

    it("should skip recursive schedule when service stops during full-batch sync", async () => {
      const scheduleSpy = jest.spyOn(Bottleneck.prototype, "schedule");
      const limit = constsMock.SYNC_BATCH_SIZE;

      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: limit + 1 }));

      /** @type {(value: { items: Array<{ id: string }> }) => void} */
      let resolveGetData = () => {};
      jest.mocked(datasetMock.getData).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGetData = assertType(resolve);
          }),
      );

      logRepositoryMock.batchInsertLogs.mockResolvedValue();

      try {
        await syncService.start();
        await waitForCondition(
          () => jest.mocked(datasetMock.getData).mock.calls.length === 1,
          WAIT_MS,
        );

        const stopPromise = syncService.stop();
        resolveGetData({
          items: Array.from({ length: limit }, (_, i) => ({ id: `full-${i}` })),
        });
        await stopPromise;
        await sleep(WAIT_MS);

        // Start triggers exactly one schedule. If recursive trigger runs after stop,
        // this would be greater than 1.
        expect(scheduleSpy.mock.calls.length).toBe(1);
      } finally {
        scheduleSpy.mockRestore();
      }
    });

    it("should log error when sync fails with non-BOTTLENECK_STOPPED error", async () => {
      // Clear any previous calls
      loggerMock.error.mockClear();

      // Mock the dataset to throw a non-BOTTLENECK_STOPPED error during getData
      jest
        .mocked(datasetMock.getInfo)
        .mockResolvedValue(assertType({ itemCount: 10 }));
      duckDbMock.executeQuery.mockResolvedValue([{ maxOffset: 0 }]);

      // Make getData throw an error
      const syncError = new Error("Database connection failed");
      jest.mocked(datasetMock.getData).mockRejectedValue(syncError);

      await syncService.start();

      // Wait longer for the sync to be attempted and error to be caught
      await sleep(WAIT_MS);

      // Should have logged an error for non-BOTTLENECK_STOPPED errors
      expect(loggerMock.error).toHaveBeenCalled();
    });
  });
});
