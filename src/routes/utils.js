/**
 * Shared utilities for route handlers.
 * @module routes/utils
 */

/**
 * Simple HTML escaping for security.
 * @param {string} unsafe
 * @returns {string}
 */
export const escapeHtml = (unsafe) => {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * Wraps an async handler to be compatible with Express RequestHandler.
 * @param {(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => Promise<void>} fn
 * @returns {import("express").RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
