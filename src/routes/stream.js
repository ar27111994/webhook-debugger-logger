/**
 * SSE Log Stream route handler module.
 * @module routes/stream
 */

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 */

/**
 * Creates the log-stream SSE route handler.
 * @param {Set<import("http").ServerResponse>} clients - Set of connected SSE clients
 * @returns {import("express").RequestHandler}
 */
export const createLogStreamHandler = (clients) => (req, res) => {
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
    console.error(
      "[SSE-ERROR] Failed to establish stream:",
      /** @type {Error} */ (error).message,
    );
    // Cleanup handled by 'close' event
  }
};
