/**
 * Global Test Environment Setup
 *
 * This file is loaded by Jest via `setupFiles` BEFORE any test code or imports run.
 * It is the correct place to define environment variables that tests rely on, ensuring
 * they are set before app modules (like src/consts.js) resolve defaults.
 *
 * @module tests/setup/env
 */

import path from "path";
import { ENV_VALUES, ENV_VARS } from "../../src/consts/app.js";
import { DUCKDB_CONSTS } from "../../src/consts/database.js";
import { STORAGE_CONSTS } from "../../src/consts/storage.js";
import { nanoid } from "nanoid";

// Force DuckDB to use in-memory mode for all tests to ensure isolation and prevented data loss
process.env[ENV_VARS.DUCKDB_FILENAME] = DUCKDB_CONSTS.MEMORY_DB;
process.env[ENV_VARS.DUCKDB_STORAGE_DIR] = path.join(
  STORAGE_CONSTS.TEMP_STORAGE,
  `webhook-debugger-logger-${nanoid()}`,
);

// Ensure other sensitive/config values are test-safe
process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;
