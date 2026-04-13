/**
 * @file src/middleware/json_parser.js
 * @module middleware/json_parser
 * @description JSON body parsing middleware with raw body preservation for signature verification.
 */
import { HTTP_HEADERS, MIME_TYPES } from "../consts/http.js";

const STRUCTURED_JSON_SUFFIX = "+json";

/**
 * @param {string | undefined} contentType
 * @returns {boolean}
 */
const isJsonContentType = (contentType) => {
  const mediaType = contentType?.split(";")[0]?.trim()?.toLowerCase();

  return (
    mediaType === MIME_TYPES.JSON ||
    mediaType?.endsWith(STRUCTURED_JSON_SUFFIX) === true
  );
};

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
  const isBufferBody = Buffer.isBuffer(req.body);
  const isStringBody = typeof req.body === "string";

  if (req.body == null || (!isBufferBody && !isStringBody)) return next();

  // Preserve raw body for signature verification (Stripe/Shopify)
  if (!("rawBody" in req)) {
    Object.defineProperty(req, "rawBody", {
      value: isBufferBody ? Buffer.from(req.body) : req.body,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  const contentType = req.get(HTTP_HEADERS.CONTENT_TYPE);

  if (isJsonContentType(contentType)) {
    const bodyText = isStringBody ? req.body : req.body.toString();

    try {
      req.body = JSON.parse(bodyText);
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (_) {
      // Ignore JSON parse errors; payload might be partial or malformed.
      // We treat it as a raw string in that case.
      req.body = bodyText;
    }
  }
  // Else: Leave the original body intact. logger_middleware will handle encoding.
  next();
};

/**
 * Factory to create JSON parser middleware.
 * @returns {RequestHandler}
 */
export const createJsonParserMiddleware = () => {
  return jsonParserMiddleware;
};
