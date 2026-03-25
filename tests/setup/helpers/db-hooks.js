/**
 * Database Hooks.
 *
 * These are used in tests to provide common functionality for database operations.
 *
 * @module tests/setup/helpers/db-hooks
 */

import { DUCKDB_TABLES } from "../../../src/consts/database.js";
import { executeWrite, getDbInstance } from "../../../src/db/duckdb.js";

/**
 * Resets the DuckDB logs table by deleting all rows.
 * When a prior suite has left stale pooled handles behind, the first delete
 * can fail with a disconnected-connection error; retrying after forcing a
 * fresh module instance keeps live-DB tests isolated without wiping healthy
 * state before every test.
 *
 * @returns {Promise<void>}
 */
export async function resetDb() {
  try {
    await getDbInstance();
    await executeWrite(`DELETE FROM ${DUCKDB_TABLES.LOGS}`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message?.toLowerCase()?.includes("disconnected")
    ) {
      throw error;
    }

    const duckDbModule = await import("../../../src/db/duckdb.js");
    await duckDbModule.closeDb();
    await duckDbModule.resetDbInstance();
    await duckDbModule.getDbInstance();
    await duckDbModule.executeWrite(`DELETE FROM ${DUCKDB_TABLES.LOGS}`);
  }
}
