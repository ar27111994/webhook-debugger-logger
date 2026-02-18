import { describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { constsMock } from "../setup/helpers/shared-mocks.js";

// Setup mocks
await setupCommonMocks({ logger: true });

import { LOG_MESSAGES } from "../../src/consts/messages.js";
import { MIME_TYPES } from "../../src/consts/http.js";

// Import middleware under test
const { createErrorHandler } = await import("../../src/middleware/error.js");
const { createRequestIdMiddleware, createCspMiddleware } =
  await import("../../src/middleware/security.js");
const { createJsonParserMiddleware } =
  await import("../../src/middleware/json_parser.js");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 */

describe("Middleware Suite", () => {
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;

  beforeEach(() => {
    req = createMockRequest();
    res = createMockResponse();
    next = createMockNextFunction();
    loggerMock.error.mockClear();
  });

  describe("Error Handler", () => {
    const handler = createErrorHandler();

    test("should delegate if headers already sent", () => {
      res.headersSent = true;
      const err = new Error("Boom");
      handler(err, req, res, next);
      expect(next).toHaveBeenCalledWith(err);
    });

    test("should sanitize HTTP_STATUS.INTERNAL_SERVER_ERROR errors", () => {
      const err = new Error("Database connection failed");
      handler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Internal Server Error",
          message: "Internal Server Error",
        }),
      );
      // Should log the actual error
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        LOG_MESSAGES.SERVER_ERROR,
      );
    });

    test("should pass through client errors (HTTP_STATUS.BAD_REQUEST)", () => {
      /** @type {CommonError} */
      const err = new Error("Invalid Input");
      err.statusCode = constsMock.HTTP_STATUS.BAD_REQUEST;
      handler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.BAD_REQUEST,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Bad Request",
          message: "Invalid Input",
        }),
      );
    });
  });

  describe("Security (CSP)", () => {
    const handler = createCspMiddleware();

    test("should add CSP headers to HTML routes", () => {
      Object.defineProperty(req, "path", { value: "/" });
      handler(req, res, next);
      expect(res.setHeader).toHaveBeenCalledWith(
        "X-Content-Type-Options",
        "nosniff",
      );
      expect(next).toHaveBeenCalled();
    });

    test("should skip CSP for API routes", () => {
      Object.defineProperty(req, "path", { value: "/api/v1/logs" });
      handler(req, res, next);
      expect(res.setHeader).not.toHaveBeenCalledWith(
        "Content-Security-Policy",
        expect.anything(),
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe("Security (Request ID)", () => {
    const handler = createRequestIdMiddleware();

    test("should generate request ID if missing", () => {
      handler(req, res, next);
      expect(assertType(req).requestId).toBeDefined();
      expect(res.setHeader).toHaveBeenCalledWith(
        "x-request-id",
        assertType(req).requestId,
      );
      expect(next).toHaveBeenCalled();
    });

    test("should preserve existing request ID", () => {
      const validId = "req_12345678901234567890D";
      req.headers["x-request-id"] = validId;
      handler(req, res, next);
      expect(assertType(req).requestId).toBe(validId);
      expect(res.setHeader).toHaveBeenCalledWith("x-request-id", validId);
    });
  });

  describe("JSON Parser", () => {
    const handler = createJsonParserMiddleware();

    test("should skip if no body or not buffer", () => {
      req.body = undefined;
      handler(req, res, next);
      expect(next).toHaveBeenCalled();

      req.body = {}; // Not buffer
      handler(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should parse JSON buffer and set rawBody", () => {
      const payload = JSON.stringify({ foo: "bar" });
      req.body = Buffer.from(payload);
      req.headers["content-type"] = MIME_TYPES.JSON;

      handler(req, res, next);

      expect(assertType(req).rawBody).toBeInstanceOf(Buffer);
      expect(req.body).toEqual({ foo: "bar" });
      expect(next).toHaveBeenCalled();
    });

    test("should fallback to string if JSON parse fails", () => {
      req.body = Buffer.from("Not JSON");
      req.headers["content-type"] = MIME_TYPES.JSON;

      handler(req, res, next);

      expect(req.body).toBe("Not JSON");
      expect(assertType(req).rawBody).toBeInstanceOf(Buffer);
    });

    test("should leave buffer alone if not JSON content type", () => {
      const buf = Buffer.from("Binary");
      req.body = buf;
      req.headers["content-type"] = "application/octet-stream";

      handler(req, res, next);

      expect(req.body).toBe(buf); // Unchanged
      expect(assertType(req).rawBody).toBe(buf);
    });
  });
});
