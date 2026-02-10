/**
 * @file src/middleware/security.js
 * @description Security middleware module providing Request ID tracing and CSP headers.
 * @module middleware/security
 */
import { nanoid } from "nanoid";
import { REQUEST_ID_PREFIX } from "../consts/app.js";
import {
  SECURITY_CONSTS,
  SECURITY_HEADERS_VALUES,
} from "../consts/security.js";
import { HTTP_HEADERS, MIME_TYPES } from "../consts/http.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").RequestHandler} RequestHandler
 */

// WeakSet to track which responses have been wrapped (prevents double-wrapping)
const wrappedResponses = new WeakSet();

/**
 * Creates request ID middleware for tracing.
 * ALWAYS generates server-side IDs - never trusts client input.
 * @returns {RequestHandler}
 */
export const createRequestIdMiddleware =
  () =>
  /** @param {Request} req @param {Response} res @param {NextFunction} next */
  (req, res, next) => {
    const requestId = `${REQUEST_ID_PREFIX}${nanoid()}`;

    // Safely attach without type casting
    Object.defineProperty(req, "requestId", {
      value: requestId,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    res.setHeader(HTTP_HEADERS.X_REQUEST_ID, requestId);
    next();
  };

/**
 * Creates security headers middleware.
 * Applies universal headers immediately, CSP only to HTML responses.
 * @returns {RequestHandler}
 */
export const createCspMiddleware =
  () =>
  /** @param {Request} _req @param {Response} res @param {NextFunction} next */
  (_req, res, next) => {
    // Set universal security headers immediately (apply to ALL responses)
    res.setHeader(
      HTTP_HEADERS.X_CONTENT_TYPE_OPTIONS,
      SECURITY_HEADERS_VALUES.NOSNIFF,
    );
    res.setHeader(HTTP_HEADERS.X_FRAME_OPTIONS, SECURITY_HEADERS_VALUES.DENY);
    res.setHeader(
      HTTP_HEADERS.REFERRER_POLICY,
      SECURITY_HEADERS_VALUES.REF_STRICT_ORIGIN,
    );
    res.setHeader(
      SECURITY_HEADERS_VALUES.HSTS_HEADER,
      SECURITY_HEADERS_VALUES.HSTS_VALUE,
    );
    res.setHeader(
      SECURITY_HEADERS_VALUES.PERMISSIONS_POLICY_HEADER,
      SECURITY_HEADERS_VALUES.PERMISSIONS_POLICY_VALUE,
    );

    // Only wrap writeHead once per response
    if (!wrappedResponses.has(res)) {
      wrappedResponses.add(res);

      const originalWriteHead = res.writeHead.bind(res);

      /** @type {(this: Response, ...args: any[]) => Response} */
      res.writeHead = function (statusCode, ...args) {
        const contentType = this.getHeader(HTTP_HEADERS.CONTENT_TYPE);

        // Apply CSP only to HTML responses
        if (
          contentType &&
          typeof contentType === "string" &&
          contentType.includes(MIME_TYPES.HTML)
        ) {
          this.setHeader(
            HTTP_HEADERS.CONTENT_SECURITY_POLICY,
            SECURITY_CONSTS.CSP_POLICY,
          );
        }

        return originalWriteHead.call(this, statusCode, ...args);
      };
    }

    next();
  };
