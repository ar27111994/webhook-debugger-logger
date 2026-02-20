/**
 * @file src/routes/utils.js
 * @description Shared utilities for route handlers including async wrappers and broadcasting.
 * @module routes/utils
 */
import { APP_CONSTS } from "../consts/app.js";
import { HTTP_STATUS, MIME_TYPES, HTTP_HEADERS } from "../consts/http.js";
import { ERROR_LABELS } from "../consts/errors.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { SSE_CONSTS, UNAUTHORIZED_HTML_TEMPLATE } from "../consts/ui.js";
import { AUTH_PLACEHOLDERS } from "../consts/auth.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger({ component: LOG_COMPONENTS.ROUTE_UTILS });

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
export const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

/**
 * Creates a broadcast function for SSE clients.
 * @param {Set<ServerResponse>} clients - Set of connected SSE clients
 * @returns {(data: any) => void}
 */
export const createBroadcaster = (clients) => (data) => {
  const message = `${SSE_CONSTS.DATA_PREFIX}${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => {
    try {
      client.write(message);
    } catch (err) {
      const safeError = {
        message: /** @type {Error} */ (err).message,
        code: /** @type {CommonError} */ (err).code || APP_CONSTS.UNKNOWN,
        name: /** @type {Error} */ (err).name,
      };
      log.error({ error: safeError }, LOG_MESSAGES.BROADCAST_FAILED);
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

/**
 * Sends a standardized 401 Unauthorized response with content negotiation.
 * @param {Request} req
 * @param {Response} res
 * @param {Object} [options]
 * @param {string} [options.error] - Custom error message
 * @param {string} [options.id] - Optional webhook ID
 * @param {string} [options.docs] - Documentation URL
 * @returns {void}
 */
export const sendUnauthorizedResponse = (req, res, options = {}) => {
  const {
    error = ERROR_LABELS.UNAUTHORIZED,
    id,
    docs = APP_CONSTS.APIFY_HOMEPAGE_URL,
  } = options;

  if (req.headers[HTTP_HEADERS.ACCEPT]?.includes(MIME_TYPES.HTML)) {
    res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .send(
        UNAUTHORIZED_HTML_TEMPLATE.replaceAll(
          AUTH_PLACEHOLDERS.APIFY_HOMEPAGE_URL,
          APP_CONSTS.APIFY_HOMEPAGE_URL,
        ).replaceAll(AUTH_PLACEHOLDERS.ERROR_MESSAGE, escapeHtml(error)),
      );
    return;
  }

  res.status(HTTP_STATUS.UNAUTHORIZED).json({
    status: HTTP_STATUS.UNAUTHORIZED,
    error: ERROR_LABELS.UNAUTHORIZED,
    id,
    docs,
    message: error,
  });
};
