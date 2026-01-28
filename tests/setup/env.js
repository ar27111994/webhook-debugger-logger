/**
 * Global Test Environment Setup
 *
 * This file is loaded by Jest via `setupFiles` BEFORE any test code or imports run.
 * It is the correct place to define environment variables that tests rely on, ensuring
 * they are set before app modules (like src/consts.js) resolve defaults.
 */

// Force DuckDB to use in-memory mode for all tests to ensure isolation and prevented data loss
process.env.DUCKDB_FILENAME = ":memory:";
process.env.DUCKDB_STORAGE_DIR = ":memory:";

// Ensure other sensitive/config values are test-safe
process.env.NODE_ENV = "test";
