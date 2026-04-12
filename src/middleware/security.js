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
 * @typedef {import("../typedefs.js").CustomRequest} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").RequestHandler} RequestHandler
 */

// WeakSet to track which responses have been wrapped (prevents double-wrapping)
const wrappedResponses = new WeakSet();
const RAW_HEADERS_STEP = 2;

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
const getStringHeaderValue = (value) => {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === "string");
  }

  return undefined;
};

/**
 * @param {unknown[]} args
 * @returns {string | undefined}
 */
const getContentTypeFromWriteHeadArgs = (args) => {
  for (const candidate of args) {
    if (Array.isArray(candidate)) {
      for (
        let index = 0;
        index < candidate.length - 1;
        index += RAW_HEADERS_STEP
      ) {
        const headerName = candidate[index];

        if (
          typeof headerName === "string" &&
          headerName.toLowerCase() === HTTP_HEADERS.CONTENT_TYPE
        ) {
          return getStringHeaderValue(candidate[index + 1]);
        }
      }

      continue;
    }

    if (!candidate || typeof candidate !== "object") continue;

    for (const [headerName, headerValue] of Object.entries(candidate)) {
      if (headerName.toLowerCase() === HTTP_HEADERS.CONTENT_TYPE) {
        return getStringHeaderValue(headerValue);
      }
    }
  }

  return undefined;
};

/**
 * @param {Request} req
 * @returns {boolean}
 */
const isSecureRequest = (req) => {
  if (req.secure === true) return true;
  if (req.protocol === "https") return true;

  const forwardedProto = req.get(HTTP_HEADERS.X_FORWARDED_PROTO);
  return typeof forwardedProto === "string"
    ? forwardedProto
        .split(",")
        .some((value) => value.trim().toLowerCase() === "https")
    : false;
};

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

    req.requestId = requestId;

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
  /** @param {Request} req @param {Response} res @param {NextFunction} next */
  (req, res, next) => {
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
    if (isSecureRequest(req)) {
      res.setHeader(
        HTTP_HEADERS.STRICT_TRANSPORT_SECURITY,
        SECURITY_HEADERS_VALUES.HSTS_VALUE,
      );
    }
    res.setHeader(
      HTTP_HEADERS.PERMISSIONS_POLICY,
      SECURITY_HEADERS_VALUES.PERMISSIONS_POLICY_VALUE,
    );

    // Only wrap writeHead once per response
    if (!wrappedResponses.has(res)) {
      wrappedResponses.add(res);

      const originalWriteHead = res.writeHead.bind(res);

      /** @type {(this: Response, ...args: any[]) => Response} */
      res.writeHead = function (statusCode, ...args) {
        const contentType =
          getStringHeaderValue(this.getHeader(HTTP_HEADERS.CONTENT_TYPE)) ??
          getContentTypeFromWriteHeadArgs(args);

        // Apply CSP only to HTML responses
        if (contentType?.includes(MIME_TYPES.HTML)) {
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
