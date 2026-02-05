/**
 * @file src/middleware/error.js
 * @description Error handling middleware for Express with sanitized responses.
 * @module middleware/error
 */
import { createChildLogger, serializeError } from "../utils/logger.js";
import { HTTP_STATUS, ERROR_LABELS } from "../consts.js";

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
    const status =
      err.statusCode || err.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    // Sanitize: don't leak internal error details for 500-level errors
    const isServerError = status >= HTTP_STATUS.INTERNAL_SERVER_ERROR;

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

    const responseBody = {
      status,
      requestId,
      error:
        status >= HTTP_STATUS.INTERNAL_SERVER_ERROR
          ? ERROR_LABELS.INTERNAL_SERVER_ERROR
          : status === HTTP_STATUS.PAYLOAD_TOO_LARGE
            ? ERROR_LABELS.PAYLOAD_TOO_LARGE
            : status === HTTP_STATUS.BAD_REQUEST
              ? ERROR_LABELS.BAD_REQUEST
              : status === HTTP_STATUS.NOT_FOUND
                ? ERROR_LABELS.NOT_FOUND
                : status >= HTTP_STATUS.BAD_REQUEST
                  ? ERROR_LABELS.CLIENT_ERROR
                  : "Error",
      message: isServerError ? ERROR_LABELS.INTERNAL_SERVER_ERROR : err.message,
    };
    res.status(status).json(responseBody);
  };
