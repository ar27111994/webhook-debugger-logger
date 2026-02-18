/**
 * @file src/consts/storage.js
 * @description Storage-related keys, markers, and thresholds.
 * @module consts/storage
 */
import { getInt } from "../utils/env.js";
import { ENV_VARS } from "./app.js";

export const DEFAULT_STORAGE_DIR =
  process.env[ENV_VARS.DUCKDB_STORAGE_DIR] ||
  process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR] ||
  "./storage";

export const STORAGE_CONSTS = Object.freeze({
  KVS_KEY_PREFIX: "payload_",
  KVS_URL_FALLBACK: "Key: ${key} (Use Actor.getValue('${key}') to retrieve)",
  CURSOR_SEPARATOR: ":",
  INPUT_JSON: "INPUT.json",
  OFFLOAD_MARKER_SYNC: "[OFFLOADED_TO_KVS]",
  OFFLOAD_MARKER_STREAM: "[OFFLOADED_VIA_STREAM]",
  DEFAULT_OFFLOAD_NOTE:
    "Payload offloaded to Key-Value Store due to size threshold in the Apify Dataset",
  KVS_OFFLOAD_THRESHOLD: getInt("KVS_OFFLOAD_THRESHOLD", 5 * 1024 * 1024),
  MAX_DATASET_ITEM_BYTES: getInt("MAX_DATASET_ITEM_BYTES", 9 * 1024 * 1024),
  PUBLIC_DIR: "public",
  FONTS_DIR_NAME: "fonts",
  TEMP_STORAGE: "/tmp/storage",
  DEFAULT_STORAGE_DIR,
});

export const KEY_VALUE_STORES_DIR = "key_value_stores";
export const DEFAULT_KVS_DIR = "default";
export const ACTOR_CONFIG_DIR = ".actor";

/** @enum {string} */
export const FILE_NAMES = Object.freeze({
  CONFIG: STORAGE_CONSTS.INPUT_JSON,
  SCHEMA: "input_schema.json",
  PACKAGE_JSON: "../package.json",
  ACTOR_JSON: `../${ACTOR_CONFIG_DIR}/actor.json`,
});

/** @enum {string} */
export const FILE_EXTENSIONS = Object.freeze({
  TMP: ".tmp",
});

/** @enum {string} */
export const KVS_KEYS = Object.freeze({
  INPUT: "INPUT",
  STATE: "WEBHOOK_STATE",
});

/** @enum {string} */
export const SCHEMA_KEYS = Object.freeze({
  SECTION_PREFIX: "section_",
  EDITOR_HIDDEN: "hidden",
});
