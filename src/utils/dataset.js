/**
 * Dataset utility functions.
 * @module utils/dataset
 */

/**
 * @typedef {import("apify").Dataset} Dataset
 */

/**
 * Finds the approximate offset for a given timestamp in a dataset using binary search.
 * Assumes the dataset is accessed with `desc: true` (newest first).
 *
 * @param {Dataset} dataset - The Apify Dataset instance.
 * @param {Date} targetTimestamp - The timestamp to search for.
 * @param {number} totalItems - Total number of items in the dataset.
 * @returns {Promise<number>} - The approximate offset where items around this timestamp begin.
 */
export async function findOffsetForTimestamp(
  dataset,
  targetTimestamp,
  totalItems,
) {
  let low = 0;
  let high = totalItems;
  const targetTime = targetTimestamp.getTime();

  // If dataset is empty or has only one item, return 0
  if (totalItems <= 1) return 0;

  /**
   * Function to get timestamp at a specific offset
   * @param {number} offset
   * @returns {Promise<number | null>}
   */
  const getTimestampAt = async (offset) => {
    // limit 1, desc: true to get the item at this "virtual" offset from newest
    const { items } = await dataset.getData({
      offset,
      limit: 1,
      desc: true,
      fields: ["timestamp"], // Optimization: only fetch timestamp
    });
    return items.length > 0 ? new Date(items[0].timestamp).getTime() : null;
  };

  // Check boundaries first to avoid unnecessary scanning
  const newestTime = await getTimestampAt(0);
  if (newestTime !== null && targetTime > newestTime) {
    // Target is newer than the newest item -> Start at 0
    return 0;
  }

  // Binary Search
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = await getTimestampAt(mid);

    if (midTime === null) {
      // Should not happen if totalItems is correct, but safe fallback
      high = mid;
      continue;
    }

    if (midTime > targetTime) {
      // mid item is NEWER than target.
      // Target is OLDER, so it must be at a HIGHER offset.
      // Move low up.
      low = mid + 1;
    } else {
      // mid item is OLDER (or equal) than target.
      // Target is NEWER (or at mid).
      // Target is at LOWER offset.
      // Move high down.
      high = mid;
    }
  }

  // Allow a small buffer (e.g., 50 items) backwards to ensure we don't miss slightly out-of-order items
  return Math.max(0, low - 50);
}
