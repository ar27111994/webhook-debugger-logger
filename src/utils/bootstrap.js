/**
 * @file src/utils/bootstrap.js
 * @description Local development bootstrap utilities.
 * Creates default INPUT.json from schema for hot-reload workflows.
 */
import * as fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createChildLogger, serializeError } from "./logger.js";

const log = createChildLogger({ component: "Bootstrap" });

/**
 * Helper to build the full configuration object by merging defaults.
 * @param {Record<string, any>} defaultInput
 * @returns {Promise<Record<string, any>>}
 */
async function buildFullConfig(defaultInput) {
  const defaults = await getDefaultsFromSchema();
  return {
    ...defaults,
    ...defaultInput,
  };
}

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

    // Validate content (handles empty/corrupt JSON after manual edits)
    try {
      const raw = await fs.readFile(inputPath, "utf-8");
      JSON.parse(raw);
    } catch (parseErr) {
      // Only rewrite if it's a JSON parse error, not a file read error
      if (parseErr instanceof SyntaxError) {
        const fullConfig = await buildFullConfig(defaultInput);

        const tmpPath = `${inputPath}.tmp`;

        await fs.writeFile(
          tmpPath,
          JSON.stringify(fullConfig, null, 2),
          "utf-8",
        );
        await fs.rename(tmpPath, inputPath);
        log.warn(
          { err: serializeError(parseErr) },
          "INPUT.json was invalid, rewritten with defaults",
        );
      } else {
        // This is likely a filesystem error (e.g. permissions)
        log.warn(
          { err: serializeError(parseErr) },
          "Failed to read INPUT.json",
        );
      }
      return;
    }
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
      try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(inputPath), { recursive: true });

        // Write defaults
        const fullConfig = await buildFullConfig(defaultInput);

        const tmpPath = `${inputPath}.tmp`;

        await fs.writeFile(
          tmpPath,
          JSON.stringify(fullConfig, null, 2),
          "utf-8",
        );

        try {
          // On some platforms rename() won't overwrite an existing file
          await fs.rm(inputPath, { force: true });
          await fs.rename(tmpPath, inputPath);
        } catch (e) {
          // Best-effort cleanup of tmp artifact
          await fs.rm(tmpPath, { force: true });
          throw e;
        }

        log.info({ inputPath }, "Local configuration initialized");
        log.info("Tip: Edit this file to hot-reload settings while running");
      } catch (writeErr) {
        log.warn(
          { err: serializeError(writeErr) },
          "Failed to write default input file",
        );
      }
    } else {
      log.warn(
        { err: serializeError(err) },
        "Unexpected error accessing INPUT.json",
      );
    }
  }
}

/**
 * Reads .actor/input_schema.json and extracts default/prefill values.
 * @returns {Promise<Record<string, any>>}
 */
async function getDefaultsFromSchema() {
  try {
    const schemaPath = process.env.APIFY_ACTOR_DIR
      ? path.join(process.env.APIFY_ACTOR_DIR, ".actor", "input_schema.json")
      : path.join(
          path.dirname(fileURLToPath(import.meta.url)), // Ensure valid cross-platform absolute path
          "..",
          "..",
          ".actor",
          "input_schema.json",
        );
    const raw = await fs.readFile(schemaPath, "utf-8");
    const schema = JSON.parse(raw);

    /** @type {Record<string, any>} */
    const defaults = {};

    if (schema.properties) {
      for (const [
        key,
        config,
      ] of /** @type {[string, {editor?: string, prefill?: any, default?: any}][]} */ (
        Object.entries(schema.properties)
      )) {
        // Skip hidden sections or non-input fields
        if (config.editor === "hidden" || key.startsWith("section_")) {
          continue;
        }

        // Priority: prefill > default
        if (config.prefill !== undefined) {
          defaults[key] = config.prefill;
        } else if (config.default !== undefined) {
          defaults[key] = config.default;
        }
      }
    }
    return defaults;
  } catch (e) {
    log.warn(
      { err: serializeError(e) },
      "Failed to load input_schema.json, using minimal defaults",
    );
    // Fallback if schema is missing (should verify with coerce in caller, but caller merges)
    return {};
  }
}
