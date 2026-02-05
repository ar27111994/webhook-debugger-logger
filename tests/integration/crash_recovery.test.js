import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { HTTP_STATUS } from "../../src/consts.js";
import { setupTestApp } from "../setup/helpers/app-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR_PARENT = path.join(__dirname, "../temp");
const TEMP_DIR = path.join(TEMP_DIR_PARENT, "crash_test");
const DB_FILE = "crash_recovery.db";

// Set ENV before imports to ensure consts.js picks them up
process.env.DUCKDB_STORAGE_DIR = TEMP_DIR;
process.env.DUCKDB_FILENAME = DB_FILE;
process.env.CRASH_TEST_ID = "crash-recover-123";

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 */

describe("Crash Recovery (Zombie Process)", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  useMockCleanup();

  beforeAll(async () => {
    // Dynamic import to ensure module cache is fresh for this test suite isolation
    const { setupCommonMocks } = await import("../setup/helpers/mock-setup.js");
    const { resetDbInstance } = await import("../../src/db/duckdb.js");

    // Clear any previous singleton state
    await resetDbInstance();

    // Ensure clean state
    await fs.rm(TEMP_DIR_PARENT, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });

    // Setup mocks - Use defaults but REAL DB
    await setupCommonMocks({
      apify: true,
      logger: true,
      db: false,
      repositories: false,
    });
  });

  afterAll(async () => {
    if (teardownApp) await teardownApp();
    // Cleanup temp dir
    await fs.rm(TEMP_DIR_PARENT, { recursive: true, force: true });
  });

  test("should recover data written by a process that exited abruptly", async () => {
    // 1. Spawn a separate process that writes to the DB and exits without closing
    const writerPath = path.join(__dirname, "../fixtures/crash_writer.js");

    // We need to run it with node options to support ESM if needed
    const child = spawn(process.execPath, [writerPath], {
      env: { ...process.env },
      stdio: "inherit",
    });

    await new Promise(
      /**
       * @param {(val?: unknown) => void} resolve
       * @param {(reason?: any) => void} reject
       */
      (resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Writer failed with code ${code}`));
        });
        child.on("error", reject);
      },
    );

    // 2. Start the main application using the SAME DB file
    // setupTestApp calls initialize(), which calls getDbInstance()
    // This should recover the WAL/checkpoint
    ({ appClient, teardownApp } = await setupTestApp());

    // 3. Query the data
    const res = await appClient.get("/logs").expect(HTTP_STATUS.OK);

    // 4. Verify the ID exists
    const item = res.body.items.find(
      /**
       * @param {LogEntry} i
       * @returns {boolean}
       */
      (i) => i.id === process.env.CRASH_TEST_ID,
    );
    expect(item).toBeDefined();
    expect(item.webhookId).toBe("crash-webhook");
  }, 30000);
});
