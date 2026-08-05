/**
 * @file src/utils/custom_script_executor.js
 * @description Validates and executes custom webhook scripts inside pooled worker isolates.
 * @module utils/custom_script_executor
 */

import crypto from "node:crypto";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import { ENV_VALUES, ENV_VARS } from "../consts/env.js";
import { getInt } from "./env.js";
import { ERROR_MESSAGES } from "../consts/errors.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { STREAM_EVENTS } from "../consts/app.js";

const CUSTOM_SCRIPT_WORKER_URL = new URL(
  "./custom_script_worker.js",
  import.meta.url,
);

const WORKER_HEAP_LIMIT_BOUNDS = Object.freeze({
  MAX_OLD_GENERATION_MB: Object.freeze({
    envVar: ENV_VARS.CUSTOM_SCRIPT_WORKER_MAX_OLD_GENERATION_MB,
    defaultValue: 32,
    min: 16,
    max: 256,
  }),
  MAX_YOUNG_GENERATION_MB: Object.freeze({
    envVar: ENV_VARS.CUSTOM_SCRIPT_WORKER_MAX_YOUNG_GENERATION_MB,
    defaultValue: 16,
    min: 8,
    max: 128,
  }),
});

/**
 * @param {string} envVar
 * @param {number} defaultValue
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function getClampedWorkerHeapLimit(envVar, defaultValue, min, max) {
  const configuredValue = getInt(envVar, defaultValue);
  return Math.min(Math.max(configuredValue, min), max);
}

const WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: getClampedWorkerHeapLimit(
    WORKER_HEAP_LIMIT_BOUNDS.MAX_OLD_GENERATION_MB.envVar,
    WORKER_HEAP_LIMIT_BOUNDS.MAX_OLD_GENERATION_MB.defaultValue,
    WORKER_HEAP_LIMIT_BOUNDS.MAX_OLD_GENERATION_MB.min,
    WORKER_HEAP_LIMIT_BOUNDS.MAX_OLD_GENERATION_MB.max,
  ),
  maxYoungGenerationSizeMb: getClampedWorkerHeapLimit(
    WORKER_HEAP_LIMIT_BOUNDS.MAX_YOUNG_GENERATION_MB.envVar,
    WORKER_HEAP_LIMIT_BOUNDS.MAX_YOUNG_GENERATION_MB.defaultValue,
    WORKER_HEAP_LIMIT_BOUNDS.MAX_YOUNG_GENERATION_MB.min,
    WORKER_HEAP_LIMIT_BOUNDS.MAX_YOUNG_GENERATION_MB.max,
  ),
  codeRangeSizeMb: 8,
  stackSizeMb: 4,
});

const TEST_DEFAULT_SCRIPT_POOL_SIZE = 1;
const PROD_DEFAULT_SCRIPT_POOL_SIZE = 2;
const DEFAULT_SCRIPT_POOL_SIZE =
  process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST ||
  process.env[ENV_VARS.JEST_WORKER_ID]
    ? TEST_DEFAULT_SCRIPT_POOL_SIZE
    : PROD_DEFAULT_SCRIPT_POOL_SIZE;
const MAX_SCRIPT_POOL_SIZE = 4;
const SCRIPT_POOL_SIZE = Math.min(
  Math.max(getInt("CUSTOM_SCRIPT_POOL_SIZE", DEFAULT_SCRIPT_POOL_SIZE), 1),
  MAX_SCRIPT_POOL_SIZE,
);
const SCRIPT_POOL_EXECUTION_BUFFER_MS = 50;
const SCRIPT_EXECUTION_TIMEOUT_CODE = "ERR_CUSTOM_SCRIPT_JOB_TIMEOUT";
const SCRIPT_WORKER_TERMINATED_MESSAGE = "Custom script worker terminated";

/** @type {Map<string, ScriptWorkerPool>} */
const SCRIPT_POOLS = new Map();
let nextJobId = 0;

/**
 * @typedef {object} CustomScriptExecutionRequest
 * @property {string} source
 * @property {Record<string, unknown>} event
 * @property {Record<string, unknown>} req
 * @property {number} timeoutMs
 */

/**
 * @typedef {object} CustomScriptExecutionResult
 * @property {boolean} ok
 * @property {Record<string, unknown>} [event]
 * @property {Array<{ level: string, args: unknown[] }>} [logs]
 * @property {Record<string, unknown>} [error]
 */

/**
 * @typedef {CustomScriptExecutionResult & { jobId: number }} WorkerResponse
 */

/**
 * @typedef {object} PendingJob
 * @property {(result: CustomScriptExecutionResult) => void} resolve
 * @property {(error: Error) => void} reject
 * @property {NodeJS.Timeout | null} timeoutHandle
 */

class ScriptWorkerClient {
  /**
   * @param {string} source
   */
  constructor(source) {
    this.source = source;
    /** @type {Worker | null} */
    this.worker = null;
    /** @type {Promise<number | void> | null} */
    this.terminationPromise = null;
    /** @type {boolean} */
    this.isDisposing = false;
    /** @type {boolean} */
    this.supportsJobPosting = true;
    /** @type {Promise<void> | null} */
    this.readyPromise = null;
    /** @type {(() => void) | null} */
    this.resolveReady = null;
    /** @type {Map<number, PendingJob>} */
    this.pendingJobs = new Map();
    this.createWorker();
  }

  createWorker() {
    if (this.isDisposing) {
      return;
    }

    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.terminationPromise = null;

    const worker = new Worker(CUSTOM_SCRIPT_WORKER_URL, {
      workerData: { source: this.source },
      resourceLimits: WORKER_RESOURCE_LIMITS,
    });

    this.supportsJobPosting = typeof worker.postMessage === "function";

    if (typeof worker.unref === "function") {
      worker.unref();
    }

    if (this.supportsJobPosting) {
      worker.on(STREAM_EVENTS.MESSAGE, (result) => {
        if (result && typeof result === "object" && result.type === "ready") {
          this.resolveReady?.();
          this.resolveReady = null;
          return;
        }
        this.handleMessage(/** @type {WorkerResponse} */ (result));
      });
      worker.on(STREAM_EVENTS.ERROR, (error) => {
        const workerError =
          error instanceof Error
            ? error
            : new Error(String(error ?? LOG_MESSAGES.UNKNOWN_ERROR));
        this.rejectAllPending(workerError);
        if (this.isDisposing) {
          return;
        }
        this.createWorker();
      });
      worker.on(STREAM_EVENTS.EXIT, (code) => {
        this.worker = null;
        if (this.isDisposing) {
          return;
        }
        if (code !== 0) {
          this.rejectAllPending(
            new Error(ERROR_MESSAGES.SCRIPT_EXECUTION_FAILED(code)),
          );
          this.createWorker();
        }
      });
    }

    this.worker = worker;
  }

  /**
   * @returns {number}
   */
  get pendingCount() {
    return this.pendingJobs.size;
  }

  /**
   * @param {CustomScriptExecutionRequest} request
   * @returns {Promise<CustomScriptExecutionResult>}
   */
  async execute(request) {
    if (!this.worker) {
      this.createWorker();
    }

    if (!this.supportsJobPosting) {
      return await this.executeLegacy(request);
    }

    await this.readyPromise;

    const jobId = ++nextJobId;
    return await new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingJobs.delete(jobId);
        this.terminateWorker();
        resolve({
          ok: false,
          logs: [],
          error: {
            name: "Error",
            code: SCRIPT_EXECUTION_TIMEOUT_CODE,
            message: LOG_MESSAGES.SCRIPT_EXECUTION_TIMEOUT_ERROR,
          },
        });
      }, request.timeoutMs + SCRIPT_POOL_EXECUTION_BUFFER_MS);

      if (typeof timeoutHandle.unref === "function") {
        timeoutHandle.unref();
      }

      this.pendingJobs.set(jobId, { resolve, reject, timeoutHandle });
      if (typeof this.worker?.postMessage === "function") {
        this.worker.postMessage({
          jobId,
          event: request.event,
          req: request.req,
          timeoutMs: request.timeoutMs,
        });
      }
    });
  }

  /**
   * @param {CustomScriptExecutionRequest} _request
   * @returns {Promise<CustomScriptExecutionResult>}
   */
  async executeLegacy(_request) {
    if (!this.worker) {
      this.createWorker();
    }

    const worker = this.worker;
    if (!worker) {
      throw new Error(SCRIPT_WORKER_TERMINATED_MESSAGE);
    }

    let settled = false;
    let exited = false;
    /** @type {Promise<number | void> | null} */
    let terminationPromise = null;

    /**
     * @returns {Promise<number | void> | null}
     */
    const terminateWorker = () => {
      if (!exited && !terminationPromise) {
        terminationPromise = worker.terminate().catch(() => undefined);
      }

      return terminationPromise;
    };

    /**
     * @param {{ awaitTermination?: boolean }} [options]
     * @returns {Promise<void>}
     */
    const cleanupWorker = async (options = {}) => {
      const { awaitTermination = false } = options;
      worker.removeAllListeners(STREAM_EVENTS.MESSAGE);
      worker.removeAllListeners(STREAM_EVENTS.ERROR);
      worker.removeAllListeners(STREAM_EVENTS.EXIT);
      this.worker = null;

      const maybeTermination = terminateWorker();
      if (awaitTermination && maybeTermination) {
        await maybeTermination;
      }
    };

    return await new Promise((resolve, reject) => {
      /**
       * @param {{ awaitTermination?: boolean }} [options]
       * @param {() => void} [settle]
       * @returns {void}
       */
      const settleAfterCleanup = (options, settle) => {
        cleanupWorker(options).then(settle, reject);
      };

      worker.once(STREAM_EVENTS.MESSAGE, (result) => {
        if (settled) {
          return;
        }

        settled = true;
        const shouldAwaitTermination =
          !!result &&
          typeof result === "object" &&
          "ok" in result &&
          result.ok === false;
        if (shouldAwaitTermination) {
          settleAfterCleanup({ awaitTermination: true }, () => {
            resolve(/** @type {CustomScriptExecutionResult} */ (result));
          });
        } else {
          settleAfterCleanup(undefined, () => {
            resolve(/** @type {CustomScriptExecutionResult} */ (result));
          });
        }
      });

      worker.once(STREAM_EVENTS.ERROR, (error) => {
        if (settled) {
          return;
        }

        settled = true;
        settleAfterCleanup({ awaitTermination: true }, () => {
          reject(error);
        });
      });

      worker.once(STREAM_EVENTS.EXIT, (code) => {
        exited = true;

        if (settled || code === 0) {
          return;
        }

        settled = true;
        settleAfterCleanup({ awaitTermination: true }, () => {
          reject(new Error(ERROR_MESSAGES.SCRIPT_EXECUTION_FAILED(code)));
        });
      });
    });
  }

  /**
   * @param {WorkerResponse} result
   */
  handleMessage(result) {
    const fallbackJobId =
      this.pendingJobs.size === 1 ? [...this.pendingJobs.keys()][0] : undefined;
    const resolvedJobId =
      typeof result?.jobId === "number" ? result.jobId : fallbackJobId;
    if (resolvedJobId === undefined) {
      return;
    }

    const pendingJob = this.pendingJobs.get(resolvedJobId);
    if (!pendingJob) {
      return;
    }

    if (pendingJob.timeoutHandle) {
      clearTimeout(pendingJob.timeoutHandle);
    }

    this.pendingJobs.delete(resolvedJobId);
    const { jobId: _jobId, ...response } = result;
    pendingJob.resolve(response);
  }

  /**
   * @param {Error} error
   */
  rejectAllPending(error) {
    for (const [jobId, pendingJob] of this.pendingJobs.entries()) {
      if (pendingJob.timeoutHandle) {
        clearTimeout(pendingJob.timeoutHandle);
      }
      pendingJob.reject(error);
      this.pendingJobs.delete(jobId);
    }
  }

  terminateWorker() {
    const worker = this.worker;
    this.worker = null;
    if (!worker) {
      return this.terminationPromise ?? Promise.resolve(undefined);
    }

    const terminationPromise = worker.terminate().catch(() => undefined);
    const trackedTermination = terminationPromise.finally(() => {
      if (this.terminationPromise === trackedTermination) {
        this.terminationPromise = null;
      }
    });
    this.terminationPromise = trackedTermination;
    return this.terminationPromise;
  }

  async dispose() {
    this.isDisposing = true;
    this.rejectAllPending(new Error(SCRIPT_WORKER_TERMINATED_MESSAGE));
    await this.terminateWorker();
  }
}

class ScriptWorkerPool {
  /**
   * @param {string} source
   */
  constructor(source) {
    this.clients = Array.from(
      { length: SCRIPT_POOL_SIZE },
      () => new ScriptWorkerClient(source),
    );
  }

  /**
   * @param {CustomScriptExecutionRequest} request
   * @returns {Promise<CustomScriptExecutionResult>}
   */
  async execute(request) {
    const client = this.clients.reduce((selected, current) =>
      current.pendingCount < selected.pendingCount ? current : selected,
    );
    return await client.execute(request);
  }

  async dispose() {
    await Promise.all(this.clients.map((client) => client.dispose()));
  }
}

/**
 * @param {string} source
 * @returns {string}
 */
function getScriptPoolKey(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

/**
 * @param {string} source
 * @returns {ScriptWorkerPool}
 */
function getScriptPool(source) {
  const poolKey = getScriptPoolKey(source);
  let pool = SCRIPT_POOLS.get(poolKey);
  if (!pool) {
    pool = new ScriptWorkerPool(source);
    SCRIPT_POOLS.set(poolKey, pool);
  }
  return pool;
}

/**
 * @param {string | undefined | null} source
 * @returns {Promise<void>}
 */
export async function invalidateCustomScriptPool(source) {
  if (!source) {
    return;
  }

  const poolKey = getScriptPoolKey(source);
  const pool = SCRIPT_POOLS.get(poolKey);
  if (!pool) {
    return;
  }

  SCRIPT_POOLS.delete(poolKey);
  await pool.dispose();
}

/**
 * @returns {Promise<void>}
 */
export async function resetCustomScriptPools() {
  const pools = [...SCRIPT_POOLS.values()];
  SCRIPT_POOLS.clear();
  await Promise.all(pools.map((pool) => pool.dispose()));
}

/**
 * @param {string} source
 * @returns {string}
 */
export function validateCustomScriptSource(source) {
  // eslint-disable-next-line sonarjs/code-eval
  const compiledScript = new vm.Script(source);
  if (!(compiledScript instanceof vm.Script)) {
    throw new Error(ERROR_MESSAGES.SCRIPT_COMPILATION_FAILED);
  }
  return source;
}

/**
 * @param {CustomScriptExecutionRequest} request
 * @returns {Promise<CustomScriptExecutionResult>}
 */
export async function executeCustomScript(request) {
  return await getScriptPool(request.source).execute(request);
}
