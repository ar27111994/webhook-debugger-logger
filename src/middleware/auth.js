/**
 * @file src/middleware/auth.js
 * @description Authentication middleware for API key validation.
 * @module middleware/auth
 */
import { validateAuth } from "../utils/auth.js";
import { sendUnauthorizedResponse } from "../routes/utils.js";
import {
  HTTP_STATUS,
  HTTP_HEADERS,
  HTTP_STATUS_MESSAGES,
} from "../consts/http.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger({ component: LOG_COMPONENTS.AUTH });

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
    if (req.headers[HTTP_HEADERS.APIFY_READINESS]) {
      res.status(HTTP_STATUS.OK).send(HTTP_STATUS_MESSAGES[HTTP_STATUS.OK]);
      return;
    }

    const authResult = validateAuth(req, getAuthKey());

    if (!authResult.isValid) {
      log.warn(
        { ip: req.ip, error: authResult.error },
        LOG_MESSAGES.UNAUTHORIZED_ACCESS,
      );
      return sendUnauthorizedResponse(req, res, { error: authResult.error });
    }
    next();
  };
