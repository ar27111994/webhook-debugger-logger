import { executeWrite } from "../../../src/db/duckdb.js";

/**
 * Resets the DuckDB logs table by deleting all rows.
 * Uses the serialized write queue to avoid concurrency conflicts.
 *
 * @returns {Promise<void>}
 */
export async function resetDb() {
  await executeWrite("DELETE FROM logs");
}
