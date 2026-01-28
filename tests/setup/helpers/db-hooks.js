import { getDbInstance } from "../../../src/db/duckdb.js";

/**
 * Resets the DuckDB logs table by deleting all rows.
 * Uses a fresh connection to avoid side effects.
 *
 * @returns {Promise<void>}
 */
export async function resetDb() {
  const db = await getDbInstance();
  const conn = await db.connect();
  try {
    await conn.run("DELETE FROM logs");
  } finally {
    conn.closeSync();
  }
}
