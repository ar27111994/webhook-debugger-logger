/**
 * @file src/utils/bootstrap.js
 * @description Local development bootstrap utilities.
 * Creates default INPUT.json from schema for hot-reload workflows.
 * @module utils/bootstrap
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createChildLogger, serializeError } from "./logger.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { ENCODINGS } from "../consts/http.js";
import {
  STORAGE_CONSTS,
  KEY_VALUE_STORES_DIR,
  DEFAULT_KVS_DIR,
  FILE_NAMES,
  ACTOR_CONFIG_DIR,
  SCHEMA_KEYS,
} from "../consts/storage.js";
import { NODE_ERROR_CODES } from "../consts/errors.js";
import { ENV_VARS } from "../consts/app.js";

const log = createChildLogger({ component: LOG_COMPONENTS.BOOTSTRAP });

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
 * @returns {Promise<void>}
 */
export async function ensureLocalInputExists(defaultInput) {
  // Only run if we are in a local environment (inferred by missing standard Apify env vars)
  // Or explicitly if APIFY_LOCAL_STORAGE_DIR is set (which local execution usually implies)

  // Apify SDK convention: storage is at './storage' or './apify_storage'
  const storageDir = STORAGE_CONSTS.DEFAULT_STORAGE_DIR;
  const inputPath = path.join(
    storageDir,
    KEY_VALUE_STORES_DIR,
    DEFAULT_KVS_DIR,
    FILE_NAMES.CONFIG,
  );

  try {
    // Check if file exists
    await fs.access(inputPath);

    // Validate content (handles empty/corrupt JSON after manual edits)
    try {
      const raw = await fs.readFile(inputPath, ENCODINGS.UTF8);
      JSON.parse(raw);
    } catch (parseErr) {
      // Only rewrite if it's a JSON parse error, not a file read error
      if (parseErr instanceof SyntaxError) {
        const fullConfig = await buildFullConfig(defaultInput);

        const tmpPath = `${inputPath}.tmp`;

        await fs.writeFile(
          tmpPath,
          JSON.stringify(fullConfig, null, 2),
          ENCODINGS.UTF8,
        );
        await fs.rename(tmpPath, inputPath);
        log.warn(
          { err: serializeError(parseErr) },
          LOG_MESSAGES.INPUT_INVALID_REWRITTEN,
        );
      } else {
        // This is likely a filesystem error (e.g. permissions)
        log.warn(
          { err: serializeError(parseErr) },
          LOG_MESSAGES.INPUT_ACCESS_ERROR,
        );
      }
      return;
    }
  } catch (err) {
    if (
      /** @type {NodeJS.ErrnoException} */ (err).code ===
      NODE_ERROR_CODES.ENOENT
    ) {
      try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(inputPath), { recursive: true });

        // Write defaults
        const fullConfig = await buildFullConfig(defaultInput);

        const tmpPath = `${inputPath}.tmp`;

        await fs.writeFile(
          tmpPath,
          JSON.stringify(fullConfig, null, 2),
          ENCODINGS.UTF8,
        );

        try {
          // Platforms like Windows might need explicit removal before rename
          await fs.rm(inputPath, { force: true });
          await fs.rename(tmpPath, inputPath);
        } catch (e) {
          // Best-effort cleanup of tmp artifact
          await fs.rm(tmpPath, { force: true });
          throw e;
        }

        log.info({ inputPath }, LOG_MESSAGES.LOCAL_CONFIG_INIT);
        log.info(LOG_MESSAGES.LOCAL_CONFIG_TIP);
      } catch (writeErr) {
        log.warn(
          { err: serializeError(writeErr) },
          LOG_MESSAGES.DEFAULT_INPUT_WRITE_FAILED,
        );
      }
    } else {
      log.warn({ err: serializeError(err) }, LOG_MESSAGES.INPUT_ACCESS_ERROR);
    }
  }
}

/**
 * Reads .actor/input_schema.json and extracts default/prefill values.
 * @returns {Promise<Record<string, any>>}
 */
export async function getDefaultsFromSchema() {
  try {
    const schemaPath = process.env[ENV_VARS.APIFY_ACTOR_DIR]
      ? path.join(
          String(process.env[ENV_VARS.APIFY_ACTOR_DIR]),
          ACTOR_CONFIG_DIR,
          FILE_NAMES.SCHEMA,
        )
      : path.join(
          path.dirname(fileURLToPath(import.meta.url)), // Ensure valid cross-platform absolute path
          "..",
          "..",
          ACTOR_CONFIG_DIR,
          FILE_NAMES.SCHEMA,
        );
    const raw = await fs.readFile(schemaPath, ENCODINGS.UTF8);
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
        if (
          config.editor === SCHEMA_KEYS.EDITOR_HIDDEN ||
          key.startsWith(SCHEMA_KEYS.SECTION_PREFIX)
        ) {
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
    log.warn({ err: serializeError(e) }, LOG_MESSAGES.SCHEMA_LOAD_FAILED);
    // Fallback if schema is missing (should verify with coerce in caller, but caller merges)
    return {};
  }
}
