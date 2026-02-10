/**
 * @file src/routes/stream.js
 * @description SSE Log Stream route handler for real-time log streaming.
 * @module routes/stream
 */

import { createChildLogger, serializeError } from "../utils/logger.js";
import {
  HTTP_STATUS,
  MIME_TYPES,
  HTTP_HEADERS,
  HTTP_STATUS_MESSAGES,
} from "../consts/http.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { SSE_CONSTS } from "../consts/ui.js";
import { SECURITY_HEADERS_VALUES } from "../consts/security.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { ERROR_MESSAGES } from "../consts/errors.js";
import { MAX_SSE_CLIENTS } from "../consts/app.js";

const log = createChildLogger({ component: LOG_COMPONENTS.STREAM });

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("http").ServerResponse} ServerResponse
 */

/**
 * Creates the log-stream SSE route handler.
 * Manages the Server-Sent Events connection, headers, and keep-alive.
 *
 * @param {Set<ServerResponse>} clients - Set of connected SSE client responses
 * @param {Object} [options]
 * @param {number} [options.maxSseClients]
 * @returns {RequestHandler} Express middleware
 */
export const createLogStreamHandler =
  (clients, { maxSseClients = MAX_SSE_CLIENTS } = {}) =>
  /** @param {Request} req @param {Response} res */
  (req, res) => {
    // 0. Enforce connection limit
    if (clients.size >= maxSseClients) {
      res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.SERVICE_UNAVAILABLE],
        message: ERROR_MESSAGES.SSE_LIMIT_REACHED(maxSseClients),
      });
      return;
    }

    // 1. Optimize headers
    res.setHeader(
      HTTP_HEADERS.CONTENT_ENCODING,
      SECURITY_HEADERS_VALUES.IDENTITY,
    ); // Disable compression
    res.setHeader(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.EVENT_STREAM);
    res.setHeader(HTTP_HEADERS.CACHE_CONTROL, SECURITY_HEADERS_VALUES.NO_CACHE);
    res.setHeader(HTTP_HEADERS.CONNECTION, SECURITY_HEADERS_VALUES.KEEP_ALIVE);
    res.setHeader(HTTP_HEADERS.X_ACCEL_BUFFERING, SECURITY_HEADERS_VALUES.NO); // Nginx: Unbuffered

    // 2. Register cleanup BEFORE writing to handle immediate close
    req.on("close", () => clients.delete(res));

    res.flushHeaders();

    // 3. Robust write with padding to force flush through proxies
    try {
      res.write(SSE_CONSTS.CONNECTED_MESSAGE);
      // Send padding to bypass proxy buffers
      res.write(`: ${" ".repeat(SSE_CONSTS.PADDING_LENGTH)}\n\n`);
      clients.add(res);
    } catch (error) {
      log.error(
        { err: serializeError(error) },
        LOG_MESSAGES.FAILED_SSE_ESTABLISH,
      );
      // Cleanup handled by 'close' event
    }
  };
