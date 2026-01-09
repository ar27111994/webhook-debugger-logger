/**
 * Promisified timeout for sleeping.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) t.unref();
  });
