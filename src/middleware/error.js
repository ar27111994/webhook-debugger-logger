/**
 * @file src/middleware/error.js
 * @description Error handling middleware for Express with sanitized responses.
 * @module middleware/error
 */
import { createChildLogger, serializeError } from "../utils/logger.js";

const log = createChildLogger({ component: "ErrorHandler" });

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").ErrorRequestHandler} ErrorRequestHandler
 * @typedef {import("../typedefs.js").CommonError} CommonError
 */

/**
 * Creates the error handling middleware.
 * @returns {ErrorRequestHandler}
 */
export const createErrorHandler =
  () =>
  /**
   * @param {CommonError} err
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.statusCode || err.status || 500;
    // Sanitize: don't leak internal error details for 500-level errors
    const isServerError = status >= 500;

    // Extract request ID for correlation
    const requestId = /** @type {any} */ (req).requestId || "unknown";

    if (isServerError) {
      log.error(
        {
          requestId,
          status,
          path: req.path,
          method: req.method,
          err: serializeError(err),
        },
        "Server error",
      );
    }

    res.status(status).json({
      status,
      requestId,
      error:
        status >= 500
          ? "Internal Server Error"
          : status === 413
            ? "Payload Too Large"
            : status === 400
              ? "Bad Request"
              : status === 404
                ? "Not Found"
                : status >= 400
                  ? "Client Error"
                  : "Error",
      message: isServerError ? "Internal Server Error" : err.message,
    });
  };
