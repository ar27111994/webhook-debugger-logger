/**
 * Authentication middleware module.
 * @module middleware/auth
 */
import { validateAuth } from "../utils/auth.js";
import { escapeHtml } from "../routes/utils.js";

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
      res.status(200).send("OK");
      return;
    }

    const authResult = validateAuth(req, getAuthKey());

    if (!authResult.isValid) {
      // Return HTML for browsers
      if (req.headers["accept"]?.includes("text/html")) {
        res.status(401).send(`
          <!DOCTYPE html>
          <html>
            <head><title>Access Restricted</title></head>
            <body>
              <h1>Access Restricted</h1>
              <p>Strict Mode enabled.</p>
              <p>${escapeHtml(authResult.error || "Unauthorized")}</p>
            </body>
          </html>
        `);
        return;
      }

      return res.status(401).json({
        status: 401,
        error: "Unauthorized",
        message: authResult.error,
      });
    }
    next();
  };
