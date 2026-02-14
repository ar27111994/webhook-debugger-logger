/**
 * @file src/middleware/json_parser.js
 * @module middleware/json_parser
 * @description JSON body parsing middleware with raw body preservation for signature verification.
 */
import { HTTP_HEADERS, MIME_TYPES } from "../consts/http.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

/**
 * Middleware to parse JSON body if content-type header is present.
 * It strictly parses strings but is lenient to buffer/string mismatch as main.js logic was.
 *
 * @param {Request} req
 * @param {Response} _res
 * @param {NextFunction} next
 */
export const jsonParserMiddleware = (req, _res, next) => {
  if (!req.body || Buffer.isBuffer(req.body) === false) return next();

  // Preserve raw body for signature verification (Stripe/Shopify)
  Object.defineProperty(req, "rawBody", {
    value: req.body,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  if (req.headers[HTTP_HEADERS.CONTENT_TYPE]?.includes(MIME_TYPES.JSON)) {
    try {
      req.body = JSON.parse(req.body.toString());
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (_) {
      // Ignore JSON parse errors; payload might be partial or malformed.
      // We treat it as a raw string in that case.
      req.body = req.body.toString();
    }
  }
  // Else: Leave as Buffer. logger_middleware will handle encoding (utf8/base64).
  next();
};

/**
 * Factory to create JSON parser middleware.
 * @returns {RequestHandler}
 */
export const createJsonParserMiddleware = () => {
  return jsonParserMiddleware;
};
