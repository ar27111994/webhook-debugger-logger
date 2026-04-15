/**
 * @file tests/unit/utils/hot_reload_manager.test.js
 * @description Unit tests for the HotReloadManager class.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import { useFakeTimers, useMockCleanup } from "../../setup/helpers/test-lifecycle.js";
import { assertType, flushPromises } from "../../setup/helpers/test-utils.js";
import { createKeyValueStoreMock } from "../../setup/helpers/shared-mocks.js";

/**
 * @typedef {import('../../../src/utils/hot_reload_manager.js').OnConfigChange} OnConfigChangeCallback
 * @typedef {import('../../setup/helpers/shared-mocks.js').KeyValueStoreMock} KeyValueStoreMock
 */

// Enable centralized mocks
await setupCommonMocks({
    fs: true,
    logger: true,
    apify: true,
    consts: true
});

const {
    loggerMock,
    apifyMock,
    fsPromisesMock,
    fsMock
} = await import("../../setup/helpers/shared-mocks.js");

const { HotReloadManager } = await import("../../../src/utils/hot_reload_manager.js");
const { LOG_MESSAGES } = await import("../../../src/consts/messages.js");
const { ENV_VARS } = await import("../../../src/consts/app.js");
const { NODE_ERROR_CODES } = await import("../../../src/consts/errors.js");

describe("HotReloadManager", () => {
    useMockCleanup();

    const DEFAULT_TEST_POLL_INTERVAL = 1000;
    const DEBOUNCE_WAIT = 20;
    const POLL_TRIGGER_WAIT = 1001;
    const LONG_ASYNC_WAIT = 5000;
    const SHORT_TICKS = 2;

    /** @type {OnConfigChangeCallback} */
    let mockOnConfigChange;
    /** @type {InstanceType<typeof HotReloadManager>} */
    let manager;
    const initialInput = { urlCount: 1 };

    /** @type {KeyValueStoreMock} */
    let mockStore;

    useFakeTimers();
    beforeEach(() => {
        mockOnConfigChange = assertType(jest.fn().mockResolvedValue(assertType(undefined)));
        manager = new HotReloadManager({
            initialInput,
            pollIntervalMs: DEFAULT_TEST_POLL_INTERVAL,
            onConfigChange: mockOnConfigChange
        });

        mockStore = createKeyValueStoreMock();
        apifyMock.openKeyValueStore.mockResolvedValue(mockStore);

        // Filesystem defaults
        fsMock.existsSync.mockReturnValue(true);

        // Set up default Actor state
        apifyMock.isAtHome.mockReturnValue(false);
        delete process.env[ENV_VARS.DISABLE_HOT_RELOAD];
    });

    describe("init()", () => {
        it("should open key value store", async () => {
            await manager.init();
            expect(apifyMock.openKeyValueStore).toHaveBeenCalled();
        });
    });

    describe("start()", () => {
        it("should log warning if start called before init", () => {
            manager.start();
            expect(loggerMock.warn).toHaveBeenCalledWith(LOG_MESSAGES.HOT_RELOAD_NOT_INIT);
        });

        it("should enable polling if not disabled by env", async () => {
            await manager.init();
            manager.start();

            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.objectContaining({ intervalMs: DEFAULT_TEST_POLL_INTERVAL }),
                LOG_MESSAGES.HOT_RELOAD_POLL_ENABLED
            );
            expect(jest.getTimerCount()).toBeGreaterThan(0);
        });

        it("should disable polling if env var set", async () => {
            process.env[ENV_VARS.DISABLE_HOT_RELOAD] = "true";
            await manager.init();

            manager.start();
            expect(loggerMock.info).toHaveBeenCalledWith(LOG_MESSAGES.HOT_RELOAD_POLL_DISABLED);
        });

        it("should start fs watch if local", async () => {
            await manager.init();
            fsMock.existsSync.mockReturnValue(true);
            manager.start();
            expect(loggerMock.info).toHaveBeenCalledWith(LOG_MESSAGES.HOT_RELOAD_LOCAL_MODE);
            expect(fsPromisesMock.watch).toHaveBeenCalled();
        });

        it("should skip fs watch if on platform", async () => {
            apifyMock.isAtHome.mockReturnValue(true);
            await manager.init();

            manager.start();
            expect(fsPromisesMock.watch).not.toHaveBeenCalled();
        });
    });

    describe("stop()", () => {
        it("should handle stop() even if not started", async () => {
            await manager.stop();
            expect(jest.getTimerCount()).toBe(0);
        });

        it("should clear interval and abort watcher", async () => {
            await manager.init();
            manager.start();
            await manager.stop();
            expect(jest.getTimerCount()).toBe(0);
        });

        it("should wait for active poll during stop", async () => {
            mockStore.getValue.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({}), LONG_ASYNC_WAIT)));
            await manager.init();
            manager.start();

            jest.advanceTimersByTime(POLL_TRIGGER_WAIT);

            const stopPromise = manager.stop();
            await jest.advanceTimersByTimeAsync(LONG_ASYNC_WAIT);
            await stopPromise;

            expect(jest.getTimerCount()).toBe(0);
        });
    });

    describe("polling behavior", () => {
        it("should trigger callback when store value changes", async () => {
            mockStore.getValue.mockResolvedValue({ urlCount: 2 });
            await manager.init();
            manager.start();

            await jest.advanceTimersByTimeAsync(POLL_TRIGGER_WAIT);

            expect(mockOnConfigChange).toHaveBeenCalled();
            expect(loggerMock.info).toHaveBeenCalledWith(LOG_MESSAGES.HOT_RELOAD_DETECTED);
        });

        it("should not trigger callback if value hasn't changed", async () => {
            mockStore.getValue.mockResolvedValue(initialInput);
            await manager.init();
            manager.start();

            await jest.advanceTimersByTimeAsync(POLL_TRIGGER_WAIT);
            expect(mockOnConfigChange).not.toHaveBeenCalled();
        });

        it("should handle polling errors gracefully", async () => {
            mockStore.getValue.mockRejectedValue(new Error("Network Error"));
            await manager.init();
            manager.start();

            await jest.advanceTimersByTimeAsync(POLL_TRIGGER_WAIT);
            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.any(Object) }),
                LOG_MESSAGES.HOT_RELOAD_POLL_FAILED
            );
        });

        it("should prevent concurrent polls", async () => {
            mockStore.getValue.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({}), LONG_ASYNC_WAIT)));
            await manager.init();
            manager.start();

            jest.advanceTimersByTime(POLL_TRIGGER_WAIT);
            jest.advanceTimersByTime(POLL_TRIGGER_WAIT);

            expect(mockStore.getValue).toHaveBeenCalledTimes(1);
        });

        it("should handle null store value gracefully during poll", async () => {
            await manager.init();
            Object.defineProperty(manager, "#store", { value: null, writable: true, configurable: true });

            manager.start();
            await jest.advanceTimersByTimeAsync(POLL_TRIGGER_WAIT);

            expect(mockOnConfigChange).toHaveBeenCalledWith({}, expect.anything());
        });

        it("should handle falsy KVS value gracefully", async () => {
            mockStore.getValue.mockResolvedValue(null);
            await manager.init();
            manager.start();

            await jest.advanceTimersByTimeAsync(POLL_TRIGGER_WAIT);
            expect(mockOnConfigChange).toHaveBeenCalledWith({}, expect.anything());
        });
    });

    describe("fs.watch behavior", () => {
        beforeEach(async () => {
            fsPromisesMock.watch.mockReturnValue(assertType(async function* () {
                yield { eventType: "change" };
                yield { eventType: "rename" };
                yield { eventType: "other" };
            })());
            mockStore.getValue.mockResolvedValue(initialInput);
            await manager.init();
        });

        it("should handle change events with debouncing", async () => {
            manager.start();
            await flushPromises(SHORT_TICKS);

            mockStore.getValue.mockResolvedValue({ urlCount: 5 });
            await jest.advanceTimersByTimeAsync(DEBOUNCE_WAIT);
            expect(mockOnConfigChange).toHaveBeenCalled();
        });

        it("should handle error with AbortError name", async () => {
            const abortError = new Error("Aborted");
            abortError.name = NODE_ERROR_CODES.ABORT_ERROR;
            // eslint-disable-next-line require-yield, sonarjs/generator-without-yield
            fsPromisesMock.watch.mockReturnValue((async function* () {
                throw abortError;
            })());

            manager.start();
            await flushPromises(SHORT_TICKS);

            expect(loggerMock.error).not.toHaveBeenCalled();
        });

        it("should log error for non-abort watch errors", async () => {
            // eslint-disable-next-line require-yield, sonarjs/generator-without-yield
            fsPromisesMock.watch.mockReturnValue((async function* () {
                throw new Error("Fatal Watch Error");
            })());

            manager.start();
            await flushPromises(SHORT_TICKS);

            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.any(Object),
                LOG_MESSAGES.HOT_RELOAD_WATCH_ERROR
            );
        });

        it("should log error if hot reload fails during watch", async () => {
            manager.start();
            await flushPromises(SHORT_TICKS);

            mockStore.getValue.mockRejectedValue(new Error("Update Fail"));
            await jest.advanceTimersByTimeAsync(DEBOUNCE_WAIT);

            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.any(Object),
                LOG_MESSAGES.HOT_RELOAD_WATCH_FAILED
            );
        });

        it("should skip watch if file missing", async () => {
            fsMock.existsSync.mockReturnValue(false);
            manager.start();
            expect(fsPromisesMock.watch).not.toHaveBeenCalled();
        });

        describe("hardening (audit feedback)", () => {
            async function* mockRenameEvent() {
                yield { eventType: "rename" };
            }

            it("should log WARNING on rename event", async () => {
                fsPromisesMock.watch.mockReturnValue(assertType(mockRenameEvent()));
                manager.start();
                await flushPromises(SHORT_TICKS);

                expect(loggerMock.warn).toHaveBeenCalledWith(LOG_MESSAGES.HOT_RELOAD_WATCHER_WARNING);
            });

            it("should normalize string input from KVS back to Object", async () => {
                const jsonInput = JSON.stringify({ urlCount: 3 });
                mockStore.getValue.mockResolvedValue(jsonInput);
                await manager.init();
                manager.start();

                await jest.advanceTimersByTimeAsync(POLL_TRIGGER_WAIT);

                expect(mockOnConfigChange).toHaveBeenCalledWith({ urlCount: 3 }, expect.anything());
            });

            it("should cancel existing debounce timer if new event arrives early", async () => {
                const spyClear = jest.spyOn(global, 'clearTimeout');
                async function* mockMultiEvents() {
                    yield { eventType: "change" };
                    // We need a tick here so that the first event is processed and timer created
                    await new Promise(resolve => setTimeout(resolve, 0));
                    yield { eventType: "change" };
                }
                fsPromisesMock.watch.mockReturnValue(assertType(mockMultiEvents()));
                manager.start();

                // Allow processing first event
                await flushPromises(SHORT_TICKS);
                // Allow processing second event (the tick in generator)
                await jest.advanceTimersByTimeAsync(0);
                await flushPromises(SHORT_TICKS);

                // Should have cleared the first timer when the second event arrived
                expect(spyClear).toHaveBeenCalled();
                spyClear.mockRestore();
            });
        });
    });
});
