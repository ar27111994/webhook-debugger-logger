/**
 * @file tests/unit/utils/custom_script_executor_mocked.test.js
 * @description Mocked unit tests for executor edge paths that require worker failures.
 */

import { describe, expect, it, jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import { STREAM_EVENTS } from "../../../src/consts/app.js";
import { ERROR_MESSAGES } from "../../../src/consts/errors.js";
import { useMockCleanup } from "../../setup/helpers/test-lifecycle.js";
import { assertType } from "../../setup/helpers/test-utils.js";

/**
 * @typedef {import("node:worker_threads").WorkerOptions} WorkerOptions
 * @typedef {jest.MockedFunction<() => Promise<void>>} TerminateMock
 * @typedef {jest.MockedFunction<() => void>} UnrefMock
 * @typedef {EventEmitter & { terminate: TerminateMock, unref?: UnrefMock }} MockWorkerInstance
 */

const WORKER_THREADS_MODULE = "node:worker_threads";
const SUCCESS_SCRIPT_SOURCE = "event.ok = true;";

/**
 * @typedef {((...args: any[]) => void) & { listener?: (...args: any[]) => void }} WrappedListener
 */

/**
 * @param {{ includeUnref?: boolean }} [options]
 * @returns {{
 *   workerInstances: Array<MockWorkerInstance>;
 *   workerOptions: Array<WorkerOptions>;
 *   terminateMock: TerminateMock;
 *   unrefMock: UnrefMock;
 *   MockWorker: new (
 *     _workerUrl: URL | string,
 *     options?: WorkerOptions,
 *   ) => MockWorkerInstance;
 * }}
 */
function createMockWorkerHarness(options = {}) {
  const { includeUnref = true } = options;
  /** @type {Array<MockWorkerInstance>} */
  const workerInstances = [];
  /** @type {Array<WorkerOptions>} */
  const workerOptions = [];
  /** @type {TerminateMock} */
  const terminateMock = jest.fn(async () => undefined);
  /** @type {UnrefMock} */
  const unrefMock = jest.fn();

  class MockWorker extends EventEmitter {
    /**
     * @param {URL | string} _workerUrl
     * @param {WorkerOptions} [options]
     */
    constructor(_workerUrl, options = {}) {
      super();
      this.terminate = terminateMock;
      if (includeUnref) {
        this.unref = unrefMock;
      }
      workerOptions.push(options);
      workerInstances.push(this);
    }
  }

  return {
    workerInstances,
    workerOptions,
    terminateMock,
    unrefMock,
    MockWorker,
  };
}

describe("Custom Script Executor worker failure paths", () => {
  useMockCleanup(() => {
    jest.resetModules();
  });

  it("should return the validated script source when compilation succeeds", async () => {
    const { validateCustomScriptSource } =
      await import("../../../src/utils/custom_script_executor.js");

    expect(validateCustomScriptSource(SUCCESS_SCRIPT_SOURCE)).toBe(
      SUCCESS_SCRIPT_SOURCE,
    );
  });

  it("should reject SCRIPT_COMPILATION_FAILED when vm compilation does not yield a vm.Script instance", async () => {
    const ScriptMock = jest.fn(function MockVmScript() {
      return {};
    });

    jest.unstable_mockModule("node:vm", () => ({
      default: { Script: ScriptMock },
      Script: ScriptMock,
    }));

    const { validateCustomScriptSource } =
      await import("../../../src/utils/custom_script_executor.js");

    expect(() => validateCustomScriptSource(SUCCESS_SCRIPT_SOURCE)).toThrow(
      ERROR_MESSAGES.SCRIPT_COMPILATION_FAILED,
    );
  });

  it("should pass the default bounded heap resource limits to Worker", async () => {
    const { workerInstances, workerOptions, MockWorker } =
      createMockWorkerHarness();

    delete process.env.CUSTOM_SCRIPT_WORKER_MAX_OLD_GENERATION_MB;
    delete process.env.CUSTOM_SCRIPT_WORKER_MAX_YOUNG_GENERATION_MB;

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
      ok: true,
      event: {},
      logs: [],
    });

    await expect(pendingResult).resolves.toEqual({
      ok: true,
      event: {},
      logs: [],
    });
    expect(workerOptions[0]?.resourceLimits).toEqual(
      expect.objectContaining({
        maxOldGenerationSizeMb: 32,
        maxYoungGenerationSizeMb: 16,
        codeRangeSizeMb: 8,
        stackSizeMb: 4,
      }),
    );
  });

  it("should clamp heap env overrides before passing them to Worker", async () => {
    const { workerInstances, workerOptions, MockWorker } =
      createMockWorkerHarness();

    try {
      process.env.CUSTOM_SCRIPT_WORKER_MAX_OLD_GENERATION_MB = "999";
      process.env.CUSTOM_SCRIPT_WORKER_MAX_YOUNG_GENERATION_MB = "1";

      jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
        Worker: MockWorker,
      }));

      const { executeCustomScript } =
        await import("../../../src/utils/custom_script_executor.js");

      const pendingResult = executeCustomScript({
        source: SUCCESS_SCRIPT_SOURCE,
        event: {},
        req: {},
        timeoutMs: 50,
      });

      workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
        ok: true,
        event: {},
        logs: [],
      });

      await expect(pendingResult).resolves.toEqual({
        ok: true,
        event: {},
        logs: [],
      });
      expect(workerOptions[0]?.resourceLimits).toEqual(
        expect.objectContaining({
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 8,
        }),
      );
    } finally {
      delete process.env.CUSTOM_SCRIPT_WORKER_MAX_OLD_GENERATION_MB;
      delete process.env.CUSTOM_SCRIPT_WORKER_MAX_YOUNG_GENERATION_MB;
    }
  });

  it("should unref supported workers once", async () => {
    const { workerInstances, unrefMock, MockWorker } =
      createMockWorkerHarness();

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    expect(unrefMock).toHaveBeenCalledTimes(1);

    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
      ok: true,
      event: { ok: true },
      logs: [],
    });

    await expect(pendingResult).resolves.toEqual({
      ok: true,
      event: { ok: true },
      logs: [],
    });
  });

  it("should clear listeners after resolution", async () => {
    const { workerInstances, MockWorker } = createMockWorkerHarness();

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    expect(workerInstances[0].listenerCount(STREAM_EVENTS.MESSAGE)).toBe(1);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.ERROR)).toBe(1);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.EXIT)).toBe(1);

    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
      ok: true,
      event: { ok: true },
      logs: [],
    });

    await expect(pendingResult).resolves.toEqual({
      ok: true,
      event: { ok: true },
      logs: [],
    });

    expect(workerInstances[0].listenerCount(STREAM_EVENTS.MESSAGE)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.ERROR)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.EXIT)).toBe(0);
  });

  it("should ignore late captured listeners after resolution", async () => {
    const { workerInstances, terminateMock, MockWorker } =
      createMockWorkerHarness();

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });
    const lateMessageListener = /** @type {WrappedListener} */ (
      workerInstances[0].rawListeners(STREAM_EVENTS.MESSAGE)[0]
    ).listener;
    const lateErrorListener = /** @type {WrappedListener} */ (
      workerInstances[0].rawListeners(STREAM_EVENTS.ERROR)[0]
    ).listener;

    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
      ok: true,
      event: { ok: true },
      logs: [],
    });

    await expect(pendingResult).resolves.toEqual({
      ok: true,
      event: { ok: true },
      logs: [],
    });

    expect(lateMessageListener).toBeInstanceOf(Function);
    expect(lateErrorListener).toBeInstanceOf(Function);

    await lateMessageListener?.call(workerInstances[0], {
      ok: false,
      event: { late: true },
      logs: [],
    });
    await lateErrorListener?.call(workerInstances[0], new Error("ignored"));

    expect(terminateMock).toHaveBeenCalledTimes(1);
  });

  it("should ignore clean worker exits until a later message settles the execution", async () => {
    const { workerInstances, terminateMock, MockWorker } =
      createMockWorkerHarness();

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    workerInstances[0].emit(STREAM_EVENTS.EXIT, 0);
    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
      ok: true,
      event: { ok: true },
      logs: [],
    });

    await expect(pendingResult).resolves.toEqual({
      ok: true,
      event: { ok: true },
      logs: [],
    });
    expect(terminateMock).not.toHaveBeenCalled();
  });

  it("should tolerate workers without unref and still cleanup listeners on error", async () => {
    const { workerInstances, terminateMock, unrefMock, MockWorker } =
      createMockWorkerHarness({ includeUnref: false });
    const workerErrorMessage = "worker failed";

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    expect(unrefMock).not.toHaveBeenCalled();
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.MESSAGE)).toBe(1);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.ERROR)).toBe(1);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.EXIT)).toBe(1);

    workerInstances[0].emit(STREAM_EVENTS.ERROR, new Error(workerErrorMessage));

    await expect(pendingResult).rejects.toThrow(workerErrorMessage);
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.MESSAGE)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.ERROR)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.EXIT)).toBe(0);
  });

  it("should reject when the worker exits unexpectedly without double-terminating the already-exited worker", async () => {
    const { workerInstances, terminateMock, MockWorker } =
      createMockWorkerHarness();

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    const exitCode = 1;
    workerInstances[0].emit(STREAM_EVENTS.EXIT, exitCode);

    await expect(pendingResult).rejects.toThrow(
      ERROR_MESSAGES.SCRIPT_EXECUTION_FAILED(exitCode),
    );
    expect(terminateMock).not.toHaveBeenCalled();
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.MESSAGE)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.ERROR)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.EXIT)).toBe(0);
  });

  it("should reject when the worker emits an error and still terminate the worker", async () => {
    const { workerInstances, terminateMock, MockWorker } =
      createMockWorkerHarness();

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    const errorMsg = "worker failed";
    workerInstances[0].emit(STREAM_EVENTS.ERROR, new Error(errorMsg));

    await expect(pendingResult).rejects.toThrow(errorMsg);
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.MESSAGE)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.ERROR)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.EXIT)).toBe(0);
  });

  it("should await worker termination when a message resolves with ok false", async () => {
    const { workerInstances, terminateMock, MockWorker } =
      createMockWorkerHarness();

    /** @type {() => void} */
    let resolveTerminate = () => {};
    /** @type {Promise<void>} */
    const terminateDeferred = new Promise((resolve) => {
      resolveTerminate = assertType(resolve);
    });
    terminateMock.mockImplementation(async () => {
      await terminateDeferred;
    });

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    const failedResult = {
      ok: false,
      event: { failed: true },
      logs: [],
      error: { message: "script failed" },
    };
    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, failedResult);

    const pendingMarker = Symbol("pending");
    await expect(
      Promise.race([pendingResult, Promise.resolve(pendingMarker)]),
    ).resolves.toBe(pendingMarker);

    resolveTerminate();

    await expect(pendingResult).resolves.toEqual(failedResult);
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.MESSAGE)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.ERROR)).toBe(0);
    expect(workerInstances[0].listenerCount(STREAM_EVENTS.EXIT)).toBe(0);
  });

  it("should ignore worker terminate failures after the worker has already resolved", async () => {
    const { workerInstances, terminateMock, MockWorker } =
      createMockWorkerHarness();

    terminateMock.mockImplementationOnce(async () => {
      throw new Error("terminate failed");
    });

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
      ok: true,
      event: { ok: true },
      logs: [],
    });

    await expect(pendingResult).resolves.toEqual({
      ok: true,
      event: { ok: true },
      logs: [],
    });
    expect(terminateMock).toHaveBeenCalledTimes(1);
  });

  it("should reject deterministically when cleanup throws during message handling", async () => {
    const { workerInstances, MockWorker } = createMockWorkerHarness();
    const cleanupErrorMessage = "cleanup failed";

    jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
      Worker: MockWorker,
    }));

    const { executeCustomScript } =
      await import("../../../src/utils/custom_script_executor.js");

    const pendingResult = executeCustomScript({
      source: SUCCESS_SCRIPT_SOURCE,
      event: {},
      req: {},
      timeoutMs: 50,
    });

    jest
      .spyOn(workerInstances[0], "removeAllListeners")
      .mockImplementationOnce(() => {
        throw new Error(cleanupErrorMessage);
      });

    workerInstances[0].emit(STREAM_EVENTS.MESSAGE, {
      ok: true,
      event: { ok: true },
      logs: [],
    });

    await expect(pendingResult).rejects.toThrow(cleanupErrorMessage);
  });
});
