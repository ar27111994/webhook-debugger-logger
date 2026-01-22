import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { useMockCleanup } from "./helpers/test-lifecycle.js";
import { waitForCondition, sleep, assertType } from "./helpers/test-utils.js";
import { INPUT_POLL_INTERVAL_TEST_MS } from "../src/consts.js";

/**
 * @typedef {import('../src/utils/hot_reload_manager.js').HotReloadManager} HotReloadManager
 * @typedef {import('./helpers/apify-mock.js').KeyValueStoreMock} KeyValueStoreMock
 */

// 1. Mock Apify
import { apifyMock } from "./helpers/shared-mocks.js";
jest.unstable_mockModule("apify", () => ({
  Actor: apifyMock,
}));
const mockActor = apifyMock;

// 2. Mock fs/promises & fs & path
const mockFsPromises = {
  watch: jest.fn(),
};
jest.unstable_mockModule("fs/promises", () => ({
  watch: mockFsPromises.watch,
}));

const mockFs = {
  existsSync: jest.fn(),
};
jest.unstable_mockModule("fs", () => mockFs);

// 3. Import the class under test
const { HotReloadManager } = await import("../src/utils/hot_reload_manager.js");

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
    mockStore = {
      getValue: jest.fn(),
      setValue: jest.fn(),
    };
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
  });

  describe("Initialization & Lifecycle", () => {
    test("should initialize store on init()", async () => {
      await manager.init();
      expect(mockActor.openKeyValueStore).toHaveBeenCalled();
      expect(manager.store).toBe(mockStore);
    });

    test("should start polling on start()", async () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      manager.start();
      expect(setIntervalSpy).toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    test("should stop polling on stop()", async () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      manager.start();
      const intervalId = manager.inputPollInterval;
      await manager.stop();
      expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
      clearIntervalSpy.mockRestore();
    });
  });

  describe("Polling Logic (_handleHotReload)", () => {
    beforeEach(async () => {
      await manager.init();
    });

    test("should do nothing if store is not initialized", async () => {
      manager.store = null;
      await manager._handleHotReload();
      expect(mockStore.getValue).not.toHaveBeenCalled();
    });

    test("should do nothing if polling is already active", async () => {
      manager.activePollPromise = Promise.resolve();
      await manager._handleHotReload();
      expect(mockStore.getValue).not.toHaveBeenCalled();
    });

    test("should trigger onConfigChange if input changed", async () => {
      mockStore.getValue.mockResolvedValue({ authKey: "new-key" });
      await manager._handleHotReload();
      expect(onConfigChange).toHaveBeenCalled();
      expect(manager.lastInputStr).toContain("new-key");
    });

    test("should catch and log errors during polling", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockStore.getValue.mockRejectedValue(new Error("KV Error"));

      await manager._handleHotReload();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SYSTEM-ERROR]"),
        "KV Error",
      );
      consoleSpy.mockRestore();
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
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      mockStore.getValue = assertType(jest.fn()).mockResolvedValue({
        authKey: "fs-change",
      });
      await manager.init();

      // Disable polling for this test to isolate watcher
      // Mock setInterval to return an object with unref stub
      const setIntervalSpy = jest
        .spyOn(global, "setInterval")
        .mockReturnValue(assertType({ unref: () => {} }));

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      manager.start();

      // Emit event 1
      mockWatcher.emit({ eventType: "change" });
      // Emit event 2 immediately (should debounce)
      mockWatcher.emit({ eventType: "change" });

      // Wait 200ms (real time) to allow debounce (100ms) to trigger
      await sleep(200);

      expect(mockStore.getValue).toHaveBeenCalledTimes(1);
      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(onConfigChange).toHaveBeenCalledWith(
        { authKey: "fs-change" },
        expect.any(Object),
      );

      mockWatcher.end();
      setIntervalSpy.mockRestore();
    });

    test("should handle fs.watch errors", async () => {
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      // Disable polling
      const setIntervalSpy = jest
        .spyOn(global, "setInterval")
        .mockReturnValue(assertType({ unref: () => {} }));

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      manager.start();

      // Simulate watcher error
      mockWatcher.error(new Error("Watcher Error"));

      // Wait for error log
      await waitForCondition(() => consoleSpy.mock.calls.length > 0, 500, 50);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SYSTEM-ERROR] fs.watch failed:"),
        "Watcher Error",
      );
      consoleSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });
  });
});
