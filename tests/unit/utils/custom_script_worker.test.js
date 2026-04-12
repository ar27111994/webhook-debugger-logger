/**
 * @file tests/unit/utils/custom_script_worker.test.js
 * @description Unit tests for custom script worker execution and serialization behavior.
 */

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { HTTP_STATUS } from "../../../src/consts/http.js";
import { LOG_MESSAGES } from "../../../src/consts/messages.js";
import { LogLevel } from "../../../src/utils/logger.js";

const WORKER_THREADS_MODULE = "node:worker_threads";
const VM_MODULE = "node:vm";
const WORKER_MODULE_PATH = "../../../src/utils/custom_script_worker.js";
const NON_ERROR_THROWN_VALUE = 123;

/**
 * @param {{
 *   workerData: Record<string, unknown>,
 *   vmFactory?: () => Promise<Record<string, unknown>> | Record<string, unknown>,
 * }} options
 * @returns {Promise<jest.Mock>}
 */
async function runWorkerModule({ workerData, vmFactory }) {
  const postMessage = jest.fn();

  jest.unstable_mockModule(WORKER_THREADS_MODULE, () => ({
    parentPort: { postMessage },
    workerData,
  }));

  if (vmFactory) {
    jest.unstable_mockModule(VM_MODULE, vmFactory);
  } else {
    const actualVmModule = await import(VM_MODULE);
    const actualVmDefault = actualVmModule.default ?? actualVmModule;
    jest.unstable_mockModule(VM_MODULE, () => ({
      ...actualVmModule,
      default: actualVmDefault,
    }));
  }

  await jest.isolateModulesAsync(async () => {
    await import(WORKER_MODULE_PATH);
  });

  return postMessage;
}

describe("Custom Script Worker", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("should normalize sandbox data and serialize all supported console log shapes", async () => {
    const postMessage = await runWorkerModule({
      workerData: {
        source: "ignored",
        event: {
          headers: { existing: true },
          query: null,
          params: [],
          responseHeaders: undefined,
        },
        req: {
          headers: { initial: "yes" },
          query: [],
          params: null,
        },
        timeoutMs: 50,
      },
      vmFactory: async () => {
        class MockScript {
          runInContext(context) {
            context.event.accepted = true;
            context.event.headers.seen = context.req.headers.initial;
            context.event.query.checked = true;
            context.event.params.id = 123;
            context.event.responseHeaders["x-result"] = "ok";
            context.console.log("debug", { nested: true });
            context.console.warn(() => "fallback");
            context.console.info(HTTP_STATUS.CREATED);
          }
        }

        const createContext = jest.fn((sandbox) => sandbox);

        return {
          default: { createContext, Script: MockScript },
          createContext,
          Script: MockScript,
        };
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      ok: true,
      event: {
        accepted: true,
        headers: { existing: true, seen: "yes" },
        query: { checked: true },
        params: { id: 123 },
        responseHeaders: { "x-result": "ok" },
      },
      logs: [
        {
          level: LogLevel.DEBUG,
          args: ["debug", { nested: true }],
        },
        {
          level: LogLevel.WARN,
          args: [expect.stringContaining("fallback")],
        },
        {
          level: LogLevel.INFO,
          args: [HTTP_STATUS.CREATED],
        },
      ],
    });
  });

  it("should serialize non-Error thrown values into a generic execution error", async () => {
    const postMessage = await runWorkerModule({
      workerData: {
        source: "ignored",
        event: null,
        req: null,
        timeoutMs: 50,
      },
      vmFactory: async () => {
        class MockScript {
          runInContext() {
            throw NON_ERROR_THROWN_VALUE;
          }
        }

        const createContext = jest.fn((sandbox) => sandbox);

        return {
          default: { createContext, Script: MockScript },
          createContext,
          Script: MockScript,
        };
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      ok: false,
      logs: [],
      error: {
        name: "Error",
        message: String(NON_ERROR_THROWN_VALUE),
      },
    });
  });

  it("should serialize same-realm Error objects with stack and code details", async () => {
    const postMessage = await runWorkerModule({
      workerData: {
        source: "ignored",
        event: {},
        req: {},
        timeoutMs: 50,
      },
      vmFactory: async () => {
        class MockScript {
          runInContext(context) {
            context.console.error(new Error("logged vm failure"));
            throw Object.assign(new Error("vm failure"), { code: "E_VM" });
          }
        }

        const createContext = jest.fn((sandbox) => sandbox);

        return {
          default: { createContext, Script: MockScript },
          createContext,
          Script: MockScript,
        };
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      ok: false,
      logs: [
        {
          level: LogLevel.ERROR,
          args: [
            expect.objectContaining({
              name: "Error",
              message: "logged vm failure",
              stack: expect.any(String),
            }),
          ],
        },
      ],
      error: expect.objectContaining({
        name: "Error",
        message: "vm failure",
        code: "E_VM",
        stack: expect.any(String),
      }),
    });
  });

  it("should fall back to the unknown error message when the thrown value is nullish", async () => {
    const postMessage = await runWorkerModule({
      workerData: {
        source: "ignored",
        event: {},
        req: {},
        timeoutMs: 50,
      },
      vmFactory: async () => {
        class MockScript {
          runInContext() {
            throw undefined;
          }
        }

        const createContext = jest.fn((sandbox) => sandbox);

        return {
          default: { createContext, Script: MockScript },
          createContext,
          Script: MockScript,
        };
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      ok: false,
      logs: [],
      error: {
        name: "Error",
        message: LOG_MESSAGES.UNKNOWN_ERROR,
      },
    });
  });
});
