/**
 * @file src/routes/stream.js
 * @description SSE Log Stream route handler for real-time log streaming.
 * @module routes/stream
 */

import { MAX_SSE_CLIENTS } from "../consts.js";
import { createChildLogger, serializeError } from "../utils/logger.js";

const log = createChildLogger({ component: "Stream" });

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
 * @returns {RequestHandler} Express middleware
 */
export const createLogStreamHandler =
  (clients) => /** @param {Request} req @param {Response} res */ (req, res) => {
    // 0. Enforce connection limit
    if (clients.size >= MAX_SSE_CLIENTS) {
      res.status(503).json({
        error: "Service Unavailable",
        message: `Maximum SSE connections reached (${MAX_SSE_CLIENTS}). Try again later.`,
      });
      return;
    }

    // 1. Optimize headers
    res.setHeader("Content-Encoding", "identity"); // Disable compression
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Nginx: Unbuffered

    // 2. Register cleanup BEFORE writing to handle immediate close
    req.on("close", () => clients.delete(res));

    res.flushHeaders();

    // 3. Robust write with padding to force flush through proxies
    try {
      res.write(": connected\n\n");
      // Send 2KB of padding to bypass proxy buffers (standard is often 4KB, but 2KB usually helps trigger flush)
      res.write(`: ${" ".repeat(2048)}\n\n`);
      clients.add(res);
    } catch (error) {
      log.error(
        { err: serializeError(error) },
        "Failed to establish SSE stream",
      );
      // Cleanup handled by 'close' event
    }
  };
