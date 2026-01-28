/**
 * Shared utilities for route handlers.
 * @module routes/utils
 */

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("../typedefs.js").CommonError} CommonError
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
 * @param {(req: Request, res: Response, next: NextFunction) => Promise<void>} fn
 * @returns {RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Creates a broadcast function for SSE clients.
 * @param {Set<ServerResponse>} clients - Set of connected SSE clients
 * @returns {(data: any) => void}
 */
export const createBroadcaster = (clients) => (data) => {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => {
    try {
      client.write(message);
    } catch (err) {
      const safeError = {
        message: /** @type {Error} */ (err).message,
        code: /** @type {CommonError} */ (err).code || "UNKNOWN",
        name: /** @type {Error} */ (err).name,
      };
      console.error(
        "[SSE-ERROR] Failed to broadcast message to client:",
        JSON.stringify(safeError),
      );
      clients.delete(client);
    }
  });
};
/**
 * Safely serializes an object to JSON-compatible format.
 * Handles BigInt by converting to Number.
 * @param {Record<string, any>} obj
 * @returns {Record<string, any>}
 */
export const jsonSafe = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (_, value) => {
      if (typeof value === "bigint") return Number(value);
      return value;
    }),
  );
};
