import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { waitForCondition, assertType } from "../setup/helpers/test-utils.js";
import { INPUT_POLL_INTERVAL_TEST_MS } from "../../src/consts.js";

/**
 * @typedef {import('../../src/utils/hot_reload_manager.js').HotReloadManager} HotReloadManager
 * @typedef {import('../setup/helpers/apify-mock.js').KeyValueStoreMock} KeyValueStoreMock
 */

// 1. Mock Apify, Logger, and FS
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true, logger: true, fs: true });
import {
  apifyMock,
  createKeyValueStoreMock,
  fsPromisesMock as mockFsPromises,
  fsMock,
} from "../setup/helpers/shared-mocks.js";
const mockActor = apifyMock;
const mockFs = fsMock;

// 3. Import the class under test
const { HotReloadManager } =
  await import("../../src/utils/hot_reload_manager.js");

// Helper to create a controllable async iterator
function createControllableIterator() {
  /** @type {Function | null} */
  let pendingResolve = null;
  /** @type {Function | null} */
  let pendingReject = null;
  let finished = false;

  const iterator = {
    next: jest.fn(() => {
      if (finished) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    }),
    return: jest.fn(() => {
      finished = true;
      return Promise.resolve({ done: true, value: undefined });
    }),
    throw: jest.fn((err) => {
      finished = true;
      return Promise.reject(err);
    }),
    [Symbol.asyncIterator]() {
      return this;
    },
    // Helper methods to control the iterator from tests
    /** @param {any} value */
    emit: (value) => {
      if (pendingResolve) {
        pendingResolve({ done: false, value });
        pendingResolve = null;
        pendingReject = null;
      }
    },
    /** @param {Error} err */
    error: (err) => {
      if (pendingReject) {
        pendingReject(err);
        pendingResolve = null;
        pendingReject = null;
      }
    },
    end: () => {
      finished = true;
      if (pendingResolve) {
        pendingResolve({ done: true, value: undefined });
        pendingResolve = null;
        pendingReject = null;
      }
    },
  };
  return iterator;
}

describe("HotReloadManager Unit Tests", () => {
  /** @type {HotReloadManager} */
  let manager;
  /** @type {KeyValueStoreMock} */
  let mockStore;
  /** @type {jest.Mock<any>} */
  let onConfigChange;

  useMockCleanup(() => {
    mockStore = createKeyValueStoreMock();
    mockActor.openKeyValueStore.mockResolvedValue(mockStore);
    mockActor.isAtHome.mockReturnValue(true);
    onConfigChange = assertType(jest.fn()).mockResolvedValue(undefined);

    manager = new HotReloadManager({
      initialInput: { authKey: "initial" },
      pollIntervalMs: INPUT_POLL_INTERVAL_TEST_MS, // Fast polling for tests
      onConfigChange,
    });
  });

  afterEach(async () => {
    if (manager) {
      await manager.stop();
    }
    jest.useRealTimers();
  });

  describe("Initialization & Lifecycle", () => {
    test("should initialize store on init()", async () => {
      await manager.init();
      expect(mockActor.openKeyValueStore).toHaveBeenCalled();
      // Cannot check private #store directly, but subsequent calls depend on it
    });

    test("should start polling on start()", async () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      manager.start();
      expect(setIntervalSpy).toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    test("should stop polling on stop()", async () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      manager.start();
      // Ensure we can access interval ID internally (not possible via private)
      // But we can check if clearInterval is called

      await manager.stop();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe("Polling Logic", () => {
    beforeEach(async () => {
      await manager.init();
      jest.useFakeTimers();
    });

    test("should trigger onConfigChange if input changed", async () => {
      mockStore.getValue.mockResolvedValue({ authKey: "new-key" });

      manager.start();

      // Advance time to trigger poll
      await jest.advanceTimersByTimeAsync(INPUT_POLL_INTERVAL_TEST_MS + 10);

      expect(mockStore.getValue).toHaveBeenCalledWith("INPUT");
      expect(onConfigChange).toHaveBeenCalled();
      expect(onConfigChange).toHaveBeenCalledWith(
        { authKey: "new-key" },
        expect.any(Object),
      );
    });

    test("should not trigger onConfigChange if input unchanged", async () => {
      mockStore.getValue.mockResolvedValue({ authKey: "initial" });

      manager.start();

      await jest.advanceTimersByTimeAsync(INPUT_POLL_INTERVAL_TEST_MS + 10);

      expect(mockStore.getValue).toHaveBeenCalled();
      expect(onConfigChange).not.toHaveBeenCalled();
    });

    test("should catch and log errors during polling", async () => {
      mockStore.getValue.mockRejectedValue(new Error("KV Error"));

      manager.start();

      await jest.advanceTimersByTimeAsync(INPUT_POLL_INTERVAL_TEST_MS + 10);

      // Source uses structured pino logging via log.error
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "KV Error" }),
        }),
        "Failed to apply new settings",
      );
    });
  });

  describe("Local Development (fs.watch)", () => {
    test("should start fs.watch if not at home (local)", async () => {
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      manager.start();

      expect(mockFsPromises.watch).toHaveBeenCalled();
      mockWatcher.end();
    });

    test("should handle fs.watch change events with debounce", async () => {
      jest.useFakeTimers();
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      mockStore.getValue = assertType(jest.fn()).mockResolvedValue({
        authKey: "fs-change",
      });
      await manager.init();

      // Disable polling for this test to isolate watcher
      jest
        .spyOn(global, "setInterval")
        .mockReturnValue(assertType({ unref: () => {} }));

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      manager.start();

      // Emit event 1
      mockWatcher.emit({ eventType: "change" });
      // Emit event 2 immediately (should debounce)
      mockWatcher.emit({ eventType: "change" });

      // Advance time to trigger debounce (100ms)
      await jest.advanceTimersByTimeAsync(200);

      expect(mockStore.getValue).toHaveBeenCalledTimes(1);
      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(onConfigChange).toHaveBeenCalledWith(
        { authKey: "fs-change" },
        expect.any(Object),
      );

      mockWatcher.end();
    });

    test("should handle fs.watch errors", async () => {
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      jest.useRealTimers();

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      manager.start();

      // Simulate watcher error
      mockWatcher.error(new Error("Watcher Error"));

      // Wait for logger error
      await waitForCondition(
        () => loggerMock.error.mock.calls.length > 0,
        500,
        50,
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "Watcher Error" }),
        }),
        "fs.watch failed",
      );
    });
  });
});
