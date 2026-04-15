/**
 * @file src/utils/custom_script_worker.js
 * @description Executes custom webhook scripts inside a throwaway worker thread.
 */

import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

import { HTTP_STATUS } from "../consts/http.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { LogLevel } from "./logger.js";

/**
 * @typedef {import("../typedefs.js").CommonError} CommonError
 */

/**
 * @typedef {object} CustomScriptExecutionRequest
 * @property {string} source
 * @property {Record<string, unknown>} event
 * @property {Record<string, unknown>} req
 * @property {number} timeoutMs
 */

/**
 * @typedef {typeof LogLevel.DEBUG | typeof LogLevel.ERROR | typeof LogLevel.WARN | typeof LogLevel.INFO} CustomScriptLogLevel
 */

/**
 * @typedef {object} CustomScriptExecutionLog
 * @property {CustomScriptLogLevel} level
 * @property {unknown[]} args
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function createSandboxRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.create(null);
  }

  return Object.assign(
    Object.create(null),
    /** @type {Record<string, unknown>} */ (value),
  );
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function serializeConsoleArg(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  try {
    return structuredClone(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function serializeExecutionError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: /** @type {CommonError} */ (error).code,
    };
  }

  return {
    name: "Error",
    message: String(error ?? LOG_MESSAGES.UNKNOWN_ERROR),
  };
}

/**
 * @param {CustomScriptLogLevel} level
 * @param {...unknown} args
 * @returns {void}
 */
function pushLog(level, ...args) {
  logs.push({ level, args: args.map(serializeConsoleArg) });
}

/**
 * @param {...unknown} args
 * @returns {void}
 */
function debugLog(...args) {
  pushLog(LogLevel.DEBUG, ...args);
}

/**
 * @param {...unknown} args
 * @returns {void}
 */
function errorLog(...args) {
  pushLog(LogLevel.ERROR, ...args);
}

/**
 * @param {...unknown} args
 * @returns {void}
 */
function warnLog(...args) {
  pushLog(LogLevel.WARN, ...args);
}

/**
 * @param {...unknown} args
 * @returns {void}
 */
function infoLog(...args) {
  pushLog(LogLevel.INFO, ...args);
}

/** @type {CustomScriptExecutionRequest} */
const executionRequest = /** @type {CustomScriptExecutionRequest} */ (
  workerData
);

/** @type {CustomScriptExecutionLog[]} */
const logs = [];

const sandboxEvent = createSandboxRecord(executionRequest.event);
sandboxEvent.headers = createSandboxRecord(sandboxEvent.headers);
sandboxEvent.query = createSandboxRecord(sandboxEvent.query);
sandboxEvent.params = createSandboxRecord(sandboxEvent.params);
sandboxEvent.responseHeaders = createSandboxRecord(
  sandboxEvent.responseHeaders,
);

const sandboxRequest = createSandboxRecord(executionRequest.req);
sandboxRequest.headers = createSandboxRecord(sandboxRequest.headers);
sandboxRequest.query = createSandboxRecord(sandboxRequest.query);
sandboxRequest.params = createSandboxRecord(sandboxRequest.params);

const sandbox = {
  event: sandboxEvent,
  req: sandboxRequest,
  console: {
    log: debugLog,
    error: errorLog,
    warn: warnLog,
    info: infoLog,
  },
  HTTP_STATUS,
};

try {
  const context = vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });
  // eslint-disable-next-line sonarjs/code-eval
  const script = new vm.Script(executionRequest.source);
  script.runInContext(context, { timeout: executionRequest.timeoutMs });
  parentPort?.postMessage({ ok: true, event: sandboxEvent, logs });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    logs,
    error: serializeExecutionError(error),
  });
}
