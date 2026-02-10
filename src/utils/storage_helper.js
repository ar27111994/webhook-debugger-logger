/**
 * @file src/utils/storage_helper.js
 * @description Utilities for offloading large payloads to Apify KeyValueStore.
 * Handles streaming uploads, reference body creation, and public URL generation.
 * @module utils/storage_helper
 */
import { Actor } from "apify";
import { nanoid } from "nanoid";
import { APP_CONSTS } from "../consts/app.js";
import { STORAGE_CONSTS } from "../consts/storage.js";

/**
 * Generates a unique key for the KVS payload.
 * @returns {string}
 */
export function generateKvsKey() {
  return `${STORAGE_CONSTS.KVS_KEY_PREFIX}${nanoid(APP_CONSTS.DEFAULT_ID_LENGTH)}`;
}

/**
 * Offloads content to the Key-Value Store.
 * @param {string} key - The key to store the value under.
 * @param {any} value - The value to store (string, buffer, stream, or object).
 * @param {string} contentType - The content type of the value.
 * @returns {Promise<void>}
 */
export async function offloadToKvs(key, value, contentType) {
  // Determine content to save (Actor.setValue supports stream, buffer, string, object)
  // If the value is an object but not a buffer/stream, Actor.setValue generally handles it,
  // but we pass contentType for metadata.
  const store = await Actor.openKeyValueStore();
  await store.setValue(key, value, { contentType });
}

/**
 * Retrieves the public URL for a stored key in the default Key-Value Store.
 * gracefully handling errors or environments where it's not supported.
 * @param {string} key
 * @returns {Promise<string>}
 */
export async function getKvsUrl(key) {
  let kvsUrl = STORAGE_CONSTS.KVS_URL_FALLBACK.replace("${key}", key).replace(
    "${key}",
    key,
  );
  try {
    const kvs = await Actor.openKeyValueStore();
    if (typeof kvs.getPublicUrl === "function") {
      kvsUrl = kvs.getPublicUrl(key);
    }
  } catch (_) {
    // Ignore errors (e.g., if running locally without full platform context or API failure)
  }
  return kvsUrl;
}

/**
 * Creates a standardized reference body object for offloaded payloads.
 * @param {object} options
 * @param {string} options.key - The KVS key.
 * @param {string} options.kvsUrl - The public URL or description.
 * @param {number} options.originalSize - The original size of the payload in bytes.
 * @param {string} [options.note] - Optional note explaining the offload.
 * @param {string} [options.data] - Optional short code for the data field.
 * @returns {Object.<string, string|number>}
 */
export function createReferenceBody({
  key,
  kvsUrl,
  originalSize,
  note = STORAGE_CONSTS.DEFAULT_OFFLOAD_NOTE,
  data = STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
}) {
  return {
    data,
    key,
    note,
    originalSize,
    kvsUrl,
  };
}
