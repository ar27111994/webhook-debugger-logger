/**
 * Error handling middleware module.
 * @module middleware/error
 */

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
   * @param {Request} _req
   * @param {Response} res
   * @param {NextFunction} next
   */
  (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.statusCode || err.status || 500;
    // Sanitize: don't leak internal error details for 500-level errors
    const isServerError = status >= 500;
    if (isServerError) {
      console.error("[SERVER-ERROR]", err.stack || err.message || err);
    }
    res.status(status).json({
      status,
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
