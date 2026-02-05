/**
 * @file src/middleware/auth.js
 * @description Authentication middleware for API key validation.
 * @module middleware/auth
 */
import { validateAuth } from "../utils/auth.js";
import { escapeHtml } from "../routes/utils.js";
import { HTTP_STATUS, UNAUTHORIZED_HTML_TEMPLATE } from "../consts.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").RequestHandler} RequestHandler
 */

/**
 * Creates authentication middleware.
 * @param {() => string | undefined} getAuthKey - Function to get current auth key
 * @returns {RequestHandler}
 */
export const createAuthMiddleware =
  (getAuthKey) =>
  /** @param {Request} req @param {Response} res @param {NextFunction} next */
  (req, res, next) => {
    // Bypass for readiness probe
    if (req.headers["x-apify-container-server-readiness-probe"]) {
      res.status(HTTP_STATUS.OK).send("OK");
      return;
    }

    const authResult = validateAuth(req, getAuthKey());

    if (!authResult.isValid) {
      // Return HTML for browsers
      if (req.headers["accept"]?.includes("text/html")) {
        res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .send(
            UNAUTHORIZED_HTML_TEMPLATE.replaceAll(
              "{{ERROR_MESSAGE}}",
              escapeHtml(authResult.error || "Unauthorized"),
            ),
          );
        return;
      }

      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        status: HTTP_STATUS.UNAUTHORIZED,
        error: "Unauthorized",
        message: authResult.error,
      });
    }
    next();
  };
