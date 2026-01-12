import fs from "fs/promises";
import path from "path";
import { coerceRuntimeOptions } from "./config.js";

/**
 * Ensures the local storage input file exists for hot-reloading.
 * @param {Record<string, any>} defaultInput
 */
export async function ensureLocalInputExists(defaultInput) {
  // Only run if we are in a local environment (inferred by missing standard Apify env vars)
  // Or explicitly if APIFY_LOCAL_STORAGE_DIR is set (which local execution usually implies)

  // Apify SDK convention: storage is at './storage' or './apify_storage'
  const storageDir = process.env.APIFY_LOCAL_STORAGE_DIR || "./storage";
  const inputPath = path.join(
    storageDir,
    "key_value_stores",
    "default",
    "INPUT.json",
  );

  try {
    // Check if file exists
    await fs.access(inputPath);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
      try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(inputPath), { recursive: true });

        // Write defaults
        const defaults = coerceRuntimeOptions(defaultInput);
        // Add other useful keys that might be missing from coercion
        const fullConfig = {
          ...defaults,
          ...defaultInput,
        };

        await fs.writeFile(
          inputPath,
          JSON.stringify(fullConfig, null, 2),
          "utf-8",
        );
        console.log(
          `[SYSTEM] 📦 Local configuration initialized at: ${inputPath}`,
        );
        console.log(
          `[SYSTEM] 💡 Tip: Edit this file to hot-reload settings while running!`,
        );
      } catch (writeErr) {
        console.warn(
          "[SYSTEM] Failed to write default input file:",
          /** @type {Error} */ (writeErr).message,
        );
      }
    }
  }
}
