/**
 * Global Test Environment Setup
 *
 * This file is loaded by Jest via `setupFiles` BEFORE any test code or imports run.
 * It is the correct place to define environment variables that tests rely on, ensuring
 * they are set before app modules (like src/consts.js) resolve defaults.
 */

import { ENV_VALUES, ENV_VARS } from "../../src/consts/app.js";

// Force DuckDB to use in-memory mode for all tests to ensure isolation and prevented data loss
process.env[ENV_VARS.DUCKDB_FILENAME] = ":memory:";
process.env[ENV_VARS.DUCKDB_STORAGE_DIR] = ":memory:";

// Ensure other sensitive/config values are test-safe
process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.TEST;
