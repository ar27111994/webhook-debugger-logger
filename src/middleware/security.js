/**
 * @file src/middleware/security.js
 * @description Security middleware module providing Request ID tracing and CSP headers.
 * @module middleware/security
 */
import { nanoid } from "nanoid";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").RequestHandler} RequestHandler
 */

/**
 * Creates request ID middleware for tracing.
 * Assigns or passes through X-Request-ID header.
 * @returns {RequestHandler}
 */
export const createRequestIdMiddleware =
  () =>
  /** @param {Request} req @param {Response} res @param {NextFunction} next */
  (req, res, next) => {
    const requestId =
      req.headers["x-request-id"]?.toString() || `req_${nanoid()}`;
    /** @type {any} */ (req).requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  };

/**
 * Creates CSP headers middleware for dashboard security.
 * @returns {RequestHandler}
 */
export const createCspMiddleware =
  () =>
  /** @param {Request} req @param {Response} res @param {NextFunction} next */
  (req, res, next) => {
    // Only apply CSP to HTML responses (dashboard)
    if (req.path === "/" || req.path.endsWith(".html")) {
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'", // Allow inline scripts for dashboard
          "style-src 'self' 'unsafe-inline'", // Allow inline styles
          "font-src 'self'",
          "img-src 'self' data:",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "base-uri 'self'",
        ].join("; "),
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    }
    next();
  };
