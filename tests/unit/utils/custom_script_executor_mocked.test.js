/**
 * @file tests/unit/utils/custom_script_executor_mocked.test.js
 * @description Mocked unit tests for executor edge paths that require worker failures.
 */

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import { STREAM_EVENTS } from "../../../src/consts/app.js";
import { ERROR_MESSAGES } from "../../../src/consts/errors.js";

/**
 * @typedef {import("node:worker_threads").WorkerOptions} WorkerOptions
 * @typedef {EventEmitter & { terminate: jest.Mock }} MockWorkerInstance
 */

const WORKER_THREADS_MODULE = "node:worker_threads";
const SUCCESS_SCRIPT_SOURCE = "event.ok = true;";

/**
 * @returns {{
 *   workerInstances: Array<MockWorkerInstance>;
 *   workerOptions: Array<WorkerOptions>;
 *   terminateMock: jest.Mock;
 *   MockWorker: new (
 *     _workerUrl: URL | string,
 *     options?: WorkerOptions,
 *   ) => MockWorkerInstance;
 * }}
 */
function createMockWorkerHarness() {
  /** @type {Array<MockWorkerInstance>} */
  const workerInstances = [];
  /** @type {Array<WorkerOptions>} */
  const workerOptions = [];
  const terminateMock = jest.fn(async () => undefined);

  class MockWorker extends EventEmitter {
    /**
     * @param {URL | string} _workerUrl
     * @param {WorkerOptions} [options]
     */
    constructor(_workerUrl, options = {}) {
      super();
      this.terminate = terminateMock;
      workerOptions.push(options);
      workerInstances.push(this);
    }
  }

  return { workerInstances, workerOptions, terminateMock, MockWorker };
}

describe("Custom Script Executor worker failure paths", () => {
  beforeEach(() => {
    jest.resetModules();
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

  it("should reject when the worker exits unexpectedly and still terminate the worker", async () => {
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
    expect(terminateMock).toHaveBeenCalledTimes(1);
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
  });
});
