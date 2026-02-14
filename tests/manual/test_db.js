import assert from "node:assert";
import { HTTP_STATUS } from "../../src/consts/index.js";
import { executeQuery, closeDb } from "../../src/db/duckdb.js";

async function testDatabase() {
  console.log("🛠️ Testing DuckDB Connection (Native Node-API)...");

  try {
    // Test Insert
    console.log("🛠️ Testing INSERT...");
    const testId = `test-${Date.now()}`;
    const timestamp = new Date();

    // New DuckDB client supports named params ($name) and passing object.
    await executeQuery(
      `INSERT INTO logs 
       (id, timestamp, method, statusCode, requestUrl, headers) 
       VALUES ($id, $timestamp, $method, $statusCode, $requestUrl, $headers)`,
      {
        id: testId,
        timestamp: timestamp.toISOString(), // Neo client needs primitives: string for timestamp usually works via cast
        method: "GET",
        statusCode: HTTP_STATUS.OK,
        requestUrl: "http://test.com",
        headers: JSON.stringify({ "x-test": "true" }), // JSON column
      },
    );
    console.log("✅ INSERT successful");

    // Test Select
    console.log("🛠️ Testing SELECT...");
    const rows = await executeQuery("SELECT * FROM logs WHERE id = $id", {
      id: testId,
    });

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].statusCode, HTTP_STATUS.OK);

    // Check JSON handling
    console.log("Row Headers Type:", typeof rows[0].headers);
    console.log("Row Headers Value:", rows[0].headers);

    console.log("✅ SELECT successful");

    // Cleanup
    await executeQuery("DELETE FROM logs WHERE id = $id", { id: testId });
    console.log("✅ Cleanup complete");
  } catch (err) {
    console.error("❌ Database Test Failed:", err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

testDatabase();
