import { getDbInstance, executeWrite } from "../../src/db/duckdb.js";

const id = process.env.CRASH_TEST_ID || "crash-id";

(async () => {
  try {
    console.log("Initializing DB...");
    // This initializes schema
    await getDbInstance();

    console.log(`Writing log with ID: ${id}`);
    await executeWrite(
      "INSERT INTO logs (id, timestamp, webhookId, method, statusCode) VALUES ($id, $timestamp, $webhookId, $method, $statusCode)",
      {
        id,
        timestamp: new Date().toISOString(),
        webhookId: "crash-webhook",
        method: "POST",
        statusCode: 200,
      },
    );

    console.log("Write complete. Simulating crash...");
    // Force exit without closing DB handles
    process.exit(0); // Using 0 to signal "reached end of script", but we treat it as crash (no cleanup)
    // Note: process.exit(0) is abrupt enough. It doesn't run closeDb().
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
