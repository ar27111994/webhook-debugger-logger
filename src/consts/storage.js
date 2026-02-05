/**
 * @file src/consts/storage.js
 * @description Storage-related keys, markers, and thresholds.
 */
import { getInt } from "../utils/env.js";

export const KVS_STATE_KEY = "WEBHOOK_STATE";
export const KVS_INPUT_KEY = "INPUT";

// Apify Dataset has a ~9MB limit per item. We use 9,000,000 to be safe.
export const MAX_DATASET_ITEM_BYTES = 9 * 1000 * 1000;

export const KVS_OFFLOAD_THRESHOLD = getInt(
  "KVS_OFFLOAD_THRESHOLD",
  5 * 1024 * 1024,
); // 5MB

export const OFFLOAD_MARKER_SYNC = "[OFFLOADED_TO_KVS]";
export const OFFLOAD_MARKER_STREAM = "[OFFLOADED_VIA_STREAM]";

export const DEFAULT_OFFLOAD_NOTE =
  "Body too large for Dataset. Stored in KeyValueStore.";
