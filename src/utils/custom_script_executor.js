/**
 * @file src/utils/custom_script_executor.js
 * @description Validates and executes custom webhook scripts inside disposable worker isolates.
 */

import vm from "node:vm";
import { Worker } from "node:worker_threads";
import { ENV_VARS } from "../consts/env.js";
import { getInt } from "./env.js";
import { ERROR_MESSAGES } from "../consts/errors.js";
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
  const worker = new Worker(CUSTOM_SCRIPT_WORKER_URL, {
    workerData: request,
    resourceLimits: WORKER_RESOURCE_LIMITS,
  });

  let settled = false;

  try {
    return await new Promise((resolve, reject) => {
      worker.once(STREAM_EVENTS.MESSAGE, (result) => {
        settled = true;
        resolve(result);
      });

      worker.once(STREAM_EVENTS.ERROR, (error) => {
        settled = true;
        reject(error);
      });

      worker.once(STREAM_EVENTS.EXIT, (code) => {
        if (settled || code === 0) {
          return;
        }

        reject(new Error(ERROR_MESSAGES.SCRIPT_EXECUTION_FAILED(code)));
      });
    });
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
