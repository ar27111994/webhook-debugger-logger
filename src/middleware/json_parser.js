/**
 * Middleware to parse JSON body if content-type header is present.
 * It strictly parses strings but is lenient to buffer/string mismatch as main.js logic was.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export const jsonParserMiddleware = (req, _res, next) => {
  if (!req.body || Buffer.isBuffer(req.body) === false) return next();
  if (req.headers["content-type"]?.includes("application/json")) {
    try {
      req.body = JSON.parse(req.body.toString());
    } catch (_) {
      req.body = req.body.toString();
    }
  } else {
    req.body = req.body.toString();
  }
  next();
};

/**
 * Factory to create JSON parser middleware.
 * @returns {import('express').RequestHandler}
 */
export const createJsonParserMiddleware = () => {
    return jsonParserMiddleware;
};
