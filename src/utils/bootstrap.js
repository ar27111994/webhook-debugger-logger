import * as fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

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

        await fs.writeFile(
          inputPath,
          JSON.stringify(fullConfig, null, 2),
          "utf-8",
        );
        console.warn(
          "[SYSTEM] INPUT.json was invalid; rewritten with defaults:",
          /** @type {Error} */ (parseErr).message,
        );
      } else {
        // This is likely a filesystem error (e.g. permissions)
        console.warn(
          "[SYSTEM] Failed to read INPUT.json:",
          /** @type {Error} */ (parseErr).message,
        );
      }
      return; 
    }

      const fullConfig = await buildFullConfig(defaultInput);

      await fs.writeFile(
        inputPath,
        JSON.stringify(fullConfig, null, 2),
        "utf-8",
      );
      console.warn(
        "[SYSTEM] INPUT.json was invalid; rewritten with defaults:",
        /** @type {Error} */ (parseErr).message,
      );
    }
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
      try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(inputPath), { recursive: true });

        // Write defaults
        const fullConfig = await buildFullConfig(defaultInput);

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
    } else {
      console.warn(
        "[SYSTEM] Unexpected error accessing INPUT.json:",
        /** @type {Error} */ (err).message,
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
    console.warn(
      "[BOOTSTRAP] Failed to load input_schema.json, using minimal defaults.",
      /** @type {Error} */ (e).message,
    );
    // Fallback if schema is missing (should verify with coerce in caller, but caller merges)
    return {};
  }
}
