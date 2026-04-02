/**
 * @file src/utils/load_env.js
 * @description Loads a local .env file for CLI and self-hosted usage without
 * overriding already injected environment variables.
 * @module utils/load_env
 */

import fs from "node:fs";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import {
  ENV_VALUES,
  ENV_VARS,
  ENV_WARNING_CODES,
} from "../consts/env.js";
import { ERROR_MESSAGES } from "../consts/errors.js";

export const PROJECT_ENV_FILE_NAME = ".env";

let hasAttemptedProjectEnvLoad = false;
/** @type {string | null} */
let loadedProjectEnvPath = null;

/**
 * Detects whether automatic .env loading should be skipped.
 * Jest sets JEST_WORKER_ID before setupFiles run, which keeps tests deterministic.
 *
 * @returns {boolean}
 */
export function shouldSkipProjectEnvLoad() {
  return (
    Boolean(process.env[ENV_VARS.JEST_WORKER_ID]) ||
    process.env[ENV_VARS.NODE_ENV] === ENV_VALUES.TEST
  );
}

/**
 * Loads the project .env file once.
 * Existing environment variables always take precedence.
 *
 * @param {{ force?: boolean, cwd?: string, envFileName?: string, override?: boolean }} [options]
 * @returns {{ loaded: boolean, path: string | null, skipped: boolean }}
 */
export function loadProjectEnv(options = {}) {
  const {
    force = false,
    cwd = process.cwd(),
    envFileName = PROJECT_ENV_FILE_NAME,
    override = false,
  } = options;

  if (!force && hasAttemptedProjectEnvLoad) {
    return {
      loaded: loadedProjectEnvPath !== null,
      path: loadedProjectEnvPath,
      skipped: false,
    };
  }

  if (!force && shouldSkipProjectEnvLoad()) {
    hasAttemptedProjectEnvLoad = true;
    loadedProjectEnvPath = null;
    return { loaded: false, path: null, skipped: true };
  }

  const envPath = path.resolve(cwd, envFileName);

  hasAttemptedProjectEnvLoad = true;
  loadedProjectEnvPath = null;

  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: null, skipped: false };
  }

  const result = dotenvConfig({ path: envPath, override, quiet: true });

  if (result.error) {
    process.emitWarning(
        ERROR_MESSAGES.PROJECT_ENV_LOAD_FAILED(
          envFileName,
          envPath,
          result.error.message
        ),
      { code: ENV_WARNING_CODES.PROJECT_ENV_LOAD_FAILED },
    );
    return { loaded: false, path: null, skipped: false };
  }

  loadedProjectEnvPath = envPath;
  return { loaded: true, path: envPath, skipped: false };
}

/**
 * Resets the module-level load state for unit tests.
 * @internal
 */
export function resetProjectEnvLoadState() {
  hasAttemptedProjectEnvLoad = false;
  loadedProjectEnvPath = null;
}

loadProjectEnv();