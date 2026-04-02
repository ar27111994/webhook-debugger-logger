/**
 * @file tests/setup/helpers/e2e-process-harness.js
 * @description Spawned-process harness for black-box e2e tests.
 * @module tests/setup/helpers/e2e-process-harness
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  APP_ROUTES,
  ENV_VALUES,
  ENV_VARS,
  SHUTDOWN_SIGNALS,
  STREAM_EVENTS,
} from "../../../src/consts/app.js";
import { ENCODINGS, HTTP_METHODS } from "../../../src/consts/http.js";
import { sleep } from "./test-utils.js";

const PROCESS_READY_TIMEOUT_MS = 30000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 100;
const HTTP_STATUS_MIN_OK = 200;
const HTTP_STATUS_MAX_CLIENT_ERROR = 500;
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * @typedef {import("node:child_process").ChildProcess} ChildProcess
 */

/**
 * @typedef {Object} SpawnedApp
 * @property {ChildProcess} process
 * @property {number} port
 * @property {string} baseUrl
 * @property {string} storageDir
 * @property {() => Promise<void>} stop
 * @property {() => Promise<string>} readStdout
 * @property {() => Promise<string>} readStderr
 */

/**
 * @typedef {Object} SpawnAppOptions
 * @property {number} port
 * @property {Record<string, unknown>} [input]
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [envOverrides]
 * @property {boolean} [injectPortEnv=true]
 * @property {boolean} [injectInputEnv=true]
 */

/**
 * Finds a free local TCP port.
 *
 * @returns {Promise<number>}
 */
export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve free port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on(STREAM_EVENTS.ERROR, reject);
  });
}

/**
 * Sends a JSON-capable HTTP request.
 *
 * @param {string} url
 * @param {string} [method=HTTP_METHODS.GET]
 * @param {Record<string, string>} [headers={}]
 * @returns {Promise<{ statusCode: number, bodyText: string, headers: Record<string, string | string[] | undefined>}>}
 */
export async function httpRequest(
  url,
  method = HTTP_METHODS.GET,
  headers = {},
) {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on(STREAM_EVENTS.DATA, (chunk) => chunks.push(Buffer.from(chunk)));
        res.on(STREAM_EVENTS.END, () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            bodyText: Buffer.concat(chunks).toString(ENCODINGS.UTF),
            headers: res.headers,
          });
        });
      },
    );

    req.on(STREAM_EVENTS.ERROR, reject);
    req.end();
  });
}

/**
 * Waits until the service responds on /health.
 *
 * @param {string} baseUrl
 * @param {number} [timeoutMs=PROCESS_READY_TIMEOUT_MS]
 * @returns {Promise<void>}
 */
export async function waitForProcessReady(
  baseUrl,
  timeoutMs = PROCESS_READY_TIMEOUT_MS,
) {
  const startedAt = Date.now();

  // Poll /health because it is exposed without auth and reflects app readiness.
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await httpRequest(`${baseUrl}${APP_ROUTES.HEALTH}`);
      if (
        response.statusCode >= HTTP_STATUS_MIN_OK &&
        response.statusCode < HTTP_STATUS_MAX_CLIENT_ERROR
      ) {
        return;
      }
    } catch {
      // Process may still be starting.
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for process readiness at ${baseUrl}`);
}

/**
 * Spawns the application as a child process for black-box e2e tests.
 *
 * @param {SpawnAppOptions} options
 * @returns {Promise<SpawnedApp>}
 */
export async function spawnAppProcess(options) {
  const {
    port,
    input,
    cwd = REPO_ROOT,
    envOverrides = {},
    injectPortEnv = true,
    injectInputEnv = true,
  } = options;
  const storageDir = await mkdtemp(path.join(tmpdir(), "wdl-e2e-"));

  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    [ENV_VARS.NODE_ENV]: ENV_VALUES.PRODUCTION,
    [ENV_VARS.DISABLE_HOT_RELOAD]: "true",
    [ENV_VARS.APIFY_LOCAL_STORAGE_DIR]: storageDir,
    ...envOverrides,
  };

  delete env[ENV_VARS.JEST_WORKER_ID];

  if (injectPortEnv) {
    env[ENV_VARS.ACTOR_WEB_SERVER_PORT] = String(port);
  }

  if (injectInputEnv && input !== undefined) {
    env[ENV_VARS.INPUT] = JSON.stringify(input);
  }

  const child = spawn(process.execPath, [path.join(REPO_ROOT, "src/main.js")], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  /** @type {Buffer[]} */
  const stdoutChunks = [];
  /** @type {Buffer[]} */
  const stderrChunks = [];

  child.stdout?.on(STREAM_EVENTS.DATA, (chunk) =>
    stdoutChunks.push(Buffer.from(chunk)),
  );
  child.stderr?.on(STREAM_EVENTS.DATA, (chunk) =>
    stderrChunks.push(Buffer.from(chunk)),
  );

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForProcessReady(baseUrl);

  const stop = async () => {
    if (child.killed || child.exitCode !== null) {
      await rm(storageDir, { recursive: true, force: true });
      return;
    }

    child.kill(SHUTDOWN_SIGNALS.SIGTERM);

    const timeout = setTimeout(() => {
      child.kill(SHUTDOWN_SIGNALS.SIGKILL);
    }, PROCESS_SHUTDOWN_TIMEOUT_MS);

    try {
      await once(child, "exit");
    } finally {
      clearTimeout(timeout);
      await rm(storageDir, { recursive: true, force: true });
    }
  };

  return {
    process: child,
    port,
    baseUrl,
    storageDir,
    stop,
    readStdout: async () => Buffer.concat(stdoutChunks).toString(ENCODINGS.UTF),
    readStderr: async () => Buffer.concat(stderrChunks).toString(ENCODINGS.UTF),
  };
}
