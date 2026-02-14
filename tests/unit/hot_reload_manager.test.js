import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  waitForCondition,
  assertType,
  sleep,
} from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/utils/hot_reload_manager.js').HotReloadManager} HotReloadManager
 * @typedef {import('../setup/helpers/apify-mock.js').KeyValueStoreMock} KeyValueStoreMock
 */

// 1. Mock Apify, Logger, and Consts
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true, logger: true, fs: true, consts: true });

import { LOG_MESSAGES } from "../../src/consts/messages.js";

// 2. Mock Shared Modules
import {
  constsMock,
  apifyMock,
  createKeyValueStoreMock,
  fsPromisesMock as mockFsPromises,
  fsMock,
  loggerMock,
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
      pollIntervalMs: constsMock.INPUT_POLL_INTERVAL_TEST_MS, // Fast polling for tests
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
      await manager.init();
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      manager.start();
      expect(setIntervalSpy).toHaveBeenCalled();
    });

    test("should handle DISABLE_HOT_RELOAD env var", async () => {
      await manager.init();
      process.env.DISABLE_HOT_RELOAD = "true";
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      manager.start();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        LOG_MESSAGES.HOT_RELOAD_POLL_DISABLED,
      );
      delete process.env.DISABLE_HOT_RELOAD;
    });

    test("should stop polling on stop()", async () => {
      await manager.init();
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      manager.start();
      // Ensure we can access interval ID internally (not possible via private)
      // But we can check if clearInterval is called

      await manager.stop();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    test("should await active poll promise on stop()", async () => {
      jest.useFakeTimers();
      await manager.init();
      /** @type {Function | null} */
      let resolvePoll = null;
      const pollPromise = new Promise((r) => {
        resolvePoll = r;
      });

      // Mock getValue to hang until we release it
      mockStore.getValue = assertType(jest.fn()).mockImplementation(
        () => pollPromise,
      );

      manager.start();

      // Advance verify timer has run
      await jest.advanceTimersByTimeAsync(
        constsMock.INPUT_POLL_INTERVAL_TEST_MS * 2,
      );

      // Stop should wait for usage
      const stopPromise = manager.stop();

      // Resolve the poll
      assertType(resolvePoll).call(null, {});
      await stopPromise;

      expect(mockStore.getValue).toHaveBeenCalled();
    });

    test("should skip start if not initialized", () => {
      const uninitializedManager = new HotReloadManager({
        initialInput: {},
        pollIntervalMs: constsMock.INPUT_POLL_INTERVAL_TEST_MS,
        onConfigChange: async () => {},
      });
      uninitializedManager.start();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "HotReloadManager not initialized, skipping start",
      );
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
      await jest.advanceTimersByTimeAsync(
        constsMock.INPUT_POLL_INTERVAL_TEST_MS + 10,
      );

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

      await jest.advanceTimersByTimeAsync(
        constsMock.INPUT_POLL_INTERVAL_TEST_MS + 10,
      );

      expect(mockStore.getValue).toHaveBeenCalled();
      expect(onConfigChange).not.toHaveBeenCalled();
    });

    test("should catch and log errors during polling", async () => {
      jest.useFakeTimers();
      mockStore.getValue = assertType(jest.fn()).mockRejectedValue(
        new Error("KV Error"),
      );
      await manager.init();
      manager.start();

      await jest.advanceTimersByTimeAsync(
        constsMock.INPUT_POLL_INTERVAL_TEST_MS + 10,
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "KV Error" }),
        }),
        LOG_MESSAGES.HOT_RELOAD_POLL_FAILED,
      );
    });
  });

  describe("Local Development (fs.watch)", () => {
    test("should start fs.watch if not at home (local)", async () => {
      await manager.init();
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

      expect(onConfigChange).toHaveBeenCalledWith(
        { authKey: "fs-change" },
        expect.any(Object),
      );

      mockWatcher.end();
    });

    test("should skip start if not initialized", () => {
      const manager = new HotReloadManager({
        initialInput: {},
        onConfigChange,
        pollIntervalMs: 100,
      });
      manager.start();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "HotReloadManager not initialized, skipping start",
      );
    });

    test("should handle fs.watch rename events", async () => {
      jest.useRealTimers();
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      // Re-create manager with large poll interval
      await manager.stop();
      manager = new HotReloadManager({
        initialInput: { authKey: "initial" },
        pollIntervalMs: 1000000,
        onConfigChange,
      });
      await manager.init();

      loggerMock.info.mockClear();
      loggerMock.warn.mockClear();

      manager.start();

      // Wait for the iterator's next() to be called (i.e., watcher is ready)
      await waitForCondition(
        () => mockWatcher.next.mock.calls.length > 0,
        1000,
        10,
      );

      // Now emit the event - the iterator is waiting for it
      mockWatcher.emit({ eventType: "rename" });

      // Wait for the warning to be logged
      await waitForCondition(
        () => loggerMock.warn.mock.calls.length > 0,
        2000,
        50,
      );

      expect(loggerMock.warn).toHaveBeenCalledWith(
        LOG_MESSAGES.HOT_RELOAD_WATCHER_WARNING,
      );
      mockWatcher.end();
    }, 10000);

    test("should log error if handleInputUpdate fails during watch", async () => {
      jest.useRealTimers();
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      mockStore.getValue = assertType(jest.fn()).mockRejectedValue(
        new Error("Update Error"),
      );
      await manager.init();

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      await manager.stop();
      manager = new HotReloadManager({
        initialInput: { authKey: "initial" },
        pollIntervalMs: 1000000,
        onConfigChange,
      });
      await manager.init();

      manager.start();
      // Allow background #startFsWatch to reach the 'for await'
      await sleep(10);

      loggerMock.error.mockClear();

      mockWatcher.emit({ eventType: "change" });

      // Change is debounced (100ms). Wait for it.
      await waitForCondition(
        () => loggerMock.error.mock.calls.length > 0,
        2000,
        100,
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "Update Error" }),
        }),
        LOG_MESSAGES.HOT_RELOAD_WATCH_FAILED,
      );
      mockWatcher.end();
    });

    test("should log success after re-applying handlers", async () => {
      jest.useRealTimers();
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      mockStore.getValue = assertType(jest.fn()).mockResolvedValue({
        authKey: "new",
      });

      await manager.stop();
      manager = new HotReloadManager({
        initialInput: { authKey: "initial" },
        pollIntervalMs: 1000000,
        onConfigChange,
      });
      await manager.init();

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      manager.start();
      // Allow background #startFsWatch to reach the 'for await'
      await sleep(10);

      loggerMock.info.mockClear();

      mockWatcher.emit({ eventType: "change" });

      await waitForCondition(
        () =>
          loggerMock.info.mock.calls.some(
            (c) => c[0] === LOG_MESSAGES.HOT_RELOAD_COMPLETE,
          ),
        2000,
        100,
      );

      expect(loggerMock.info).toHaveBeenCalledWith(
        LOG_MESSAGES.HOT_RELOAD_COMPLETE,
      );
      mockWatcher.end();
    });

    test("should handle fs.watch errors", async () => {
      jest.useRealTimers();
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      await manager.init();
      loggerMock.error.mockClear();

      manager.start();

      // Wait for the iterator's next() to be called (i.e., watcher is ready)
      await waitForCondition(
        () => mockWatcher.next.mock.calls.length > 0,
        1000,
        10,
      );

      // Now emit the error - the iterator is waiting
      mockWatcher.error(new Error("Watcher Error"));

      // Wait for logger error
      await waitForCondition(
        () => loggerMock.error.mock.calls.length > 0,
        2000,
        50,
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "Watcher Error" }),
        }),
        LOG_MESSAGES.HOT_RELOAD_WATCH_ERROR,
      );
    }, 10000);

    test("should log error if fs.watch hot-reload fails", async () => {
      jest.useRealTimers();
      mockActor.isAtHome.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      mockStore.getValue = assertType(jest.fn()).mockRejectedValue(
        new Error("FS Watch Reload Fail"),
      );
      await manager.init();

      const mockWatcher = createControllableIterator();
      mockFsPromises.watch.mockReturnValue(mockWatcher);

      manager.start();
      // wait for microtasks
      await sleep(10);

      mockWatcher.emit({ eventType: "change" });

      await waitForCondition(
        () =>
          loggerMock.error.mock.calls.some(
            (c) => c[1] === LOG_MESSAGES.HOT_RELOAD_WATCH_FAILED,
          ),
        2000,
        100,
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "FS Watch Reload Fail" }),
        }),
        LOG_MESSAGES.HOT_RELOAD_WATCH_FAILED,
      );
      mockWatcher.end();
    });
  });
});
