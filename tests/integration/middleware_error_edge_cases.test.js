import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "../setup/helpers/test-utils.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 * @typedef {import("express").ErrorRequestHandler} ErrorRequestHandler
 */

// Setup logger mock before importing error middleware
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ logger: true });

const { createErrorHandler } = await import("../../src/middleware/error.js");

describe("Error Middleware - Edge Cases", () => {
  /**
   * @type {Request}
   */
  let req;
  /**
   * @type {Response}
   */
  let res;
  /**
   * @type {NextFunction}
   */
  let next;
  /**
   * @type {ErrorRequestHandler}
   */
  let errorHandler;

  useMockCleanup();

  beforeEach(() => {
    req = createMockRequest();
    res = createMockResponse();
    next = createMockNextFunction();
    errorHandler = createErrorHandler();
  });

  describe("Error Status Code Extraction", () => {
    test("should use err.statusCode if present", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.statusCode = 404;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 404,
        error: "Not Found",
        message: "Test error",
      });
    });

    test("should use err.status if statusCode not present", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.status = 403;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 403,
        error: "Client Error",
        message: "Test error",
      });
    });

    test("should default to 500 if no status info", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 500,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
    });

    test("should prefer statusCode over status", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.statusCode = 400;
      err.status = 500;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("Server Error Sanitization (5xx)", () => {
    test("should log server errors to structured logger", () => {
      const err = /** @type {CommonError} */ (
        new Error("Internal database error")
      );
      err.statusCode = 500;

      errorHandler(err, req, res, next);

      // Source uses structured pino logging via log.error
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          status: 500,
        }),
        "Server error",
      );
    });

    test("should sanitize error message for 500 errors", () => {
      const err = /** @type {CommonError} */ (
        new Error("Database connection string: secret123")
      );
      err.statusCode = 500;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 500,
        error: "Internal Server Error",
        message: "Internal Server Error", // Sanitized, not original message
      });
    });

    test("should sanitize error message for 502 errors", () => {
      const err = /** @type {CommonError} */ (new Error("Proxy error details"));
      err.statusCode = 502;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 502,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
    });

    test("should sanitize error message for 503 errors", () => {
      const err = /** @type {CommonError} */ (new Error("Service details"));
      err.statusCode = 503;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 503,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
    });

    test("should log err.stack if available", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.statusCode = 500;
      err.stack = "Error: Test error\n    at file.js:10:5";

      errorHandler(err, req, res, next);
      // Source uses structured pino logging with serialized error
      // Note: The mock serializeError extracts message from Error instances
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            stack: err.stack,
          }),
          status: 500,
        }),
        "Server error",
      );
    });

    test("should log err.message if no stack", () => {
      const err = /** @type {CommonError} */ ({
        message: "Test error",
        statusCode: 500,
      });

      errorHandler(err, req, res, next);
      // Source uses structured pino logging with serialized error
      // Plain objects passed to serializeError mock are serialized differently
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            message: err.message,
          }),
          status: 500,
        }),
        "Server error",
      );
    });

    test("should log err object if no message or stack", () => {
      const err = /** @type {CommonError} */ ({
        statusCode: 500,
        someProperty: "value",
      });

      errorHandler(err, req, res, next);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.anything(),
        }),
        "Server error",
      );
    });
  });

  describe("Client Error Handling (4xx)", () => {
    test("should return original message for 400 errors", () => {
      const err = /** @type {CommonError} */ (new Error("Invalid JSON"));
      err.statusCode = 400;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 400,
        error: "Bad Request",
        message: "Invalid JSON",
      });
    });

    test("should return original message for 401 errors", () => {
      const err = /** @type {CommonError} */ (
        new Error("Authentication required")
      );
      err.statusCode = 401;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 401,
        error: "Client Error",
        message: "Authentication required",
      });
    });

    test("should return specific error for 413 errors", () => {
      const err = /** @type {CommonError} */ (
        new Error("Payload exceeds limit")
      );
      err.statusCode = 413;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 413,
        error: "Payload Too Large",
        message: "Payload exceeds limit",
      });
    });

    test("should return specific error for 404 errors", () => {
      const err = /** @type {CommonError} */ (new Error("Resource not found"));
      err.statusCode = 404;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 404,
        error: "Not Found",
        message: "Resource not found",
      });
    });

    test("should return generic 'Client Error' for other 4xx", () => {
      const err = /** @type {CommonError} */ (new Error("Conflict"));
      err.statusCode = 409;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 409,
        error: "Client Error",
        message: "Conflict",
      });
    });

    test("should NOT log 4xx errors to structured logger", () => {
      const err = /** @type {CommonError} */ (new Error("Not found"));
      err.statusCode = 404;

      errorHandler(err, req, res, next);

      expect(loggerMock.error).not.toHaveBeenCalled();
    });
  });

  describe("Headers Sent Edge Case", () => {
    test("should call next if headers already sent", () => {
      res.headersSent = true;

      const err = /** @type {CommonError} */ (new Error("Test error"));

      errorHandler(err, req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    test("should not send response if headers sent", () => {
      res.headersSent = true;

      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.statusCode = 500;

      errorHandler(err, req, res, next);

      expect(loggerMock.error).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe("Error Object Variations", () => {
    test("should handle Error instance", () => {
      const err = /** @type {CommonError} */ (new Error("Standard error"));
      err.statusCode = 400;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 400,
        error: "Bad Request",
        message: "Standard error",
      });
    });

    test("should handle TypeError", () => {
      const err = /** @type {CommonError} */ (
        new TypeError("Cannot read property")
      );
      err.statusCode = 500;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 500,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
    });

    test("should handle RangeError", () => {
      const err = /** @type {CommonError} */ (new RangeError("Invalid range"));
      err.statusCode = 400;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 400,
        error: "Bad Request",
        message: "Invalid range",
      });
    });

    test("should handle plain object error", () => {
      const err = /** @type {CommonError} */ ({
        message: "Plain object error",
        statusCode: 422,
      });

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 422,
        error: "Client Error",
        message: "Plain object error",
      });
    });

    test("should handle error with no message property", () => {
      const err = /** @type {CommonError} */ ({
        statusCode: 400,
        // No message
      });

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 400,
        error: "Bad Request",
        message: undefined,
      });
    });

    test("should handle error with empty message", () => {
      const err = /** @type {CommonError} */ (new Error(""));
      err.statusCode = 400;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 400,
        error: "Bad Request",
        message: "",
      });
    });
  });

  describe("Edge Status Codes", () => {
    test("should handle status 0 (falsy, defaults to 500)", () => {
      const err = /** @type {CommonError} */ (new Error("Zero status"));
      err.statusCode = 0;

      errorHandler(err, req, res, next);

      // Status 0 is falsy, so defaults to 500
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 500,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
    });

    test("should handle status 999 (non-standard)", () => {
      const err = /** @type {CommonError} */ (new Error("Custom status"));
      err.statusCode = 999;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(999);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 999,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
    });

    test("should handle negative status code", () => {
      const err = /** @type {CommonError} */ (new Error("Negative status"));
      err.statusCode = -1;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(-1);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: -1,
        error: "Error",
        message: "Negative status",
      });
    });

    test("should handle 1xx status codes", () => {
      const err = /** @type {CommonError} */ (new Error("Informational"));
      err.statusCode = 100;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 100,
        error: "Error",
        message: "Informational",
      });
    });

    test("should handle 2xx status codes (unusual for errors)", () => {
      const err = /** @type {CommonError} */ (new Error("Success error"));
      err.statusCode = 200;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 200,
        error: "Error",
        message: "Success error",
      });
    });

    test("should handle 3xx status codes", () => {
      const err = /** @type {CommonError} */ (new Error("Redirect error"));
      err.statusCode = 302;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 302,
        error: "Error",
        message: "Redirect error",
      });
    });
  });

  describe("Response Method Chaining", () => {
    test("should properly chain status() and json()", () => {
      const err = /** @type {CommonError} */ (new Error("Test"));
      err.statusCode = 400;

      errorHandler(err, req, res, next);

      // Verify status was called first
      expect(jest.mocked(res.status).mock.results[0].value).toBe(res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("Concurrent Error Handling", () => {
    test("should handle multiple errors sequentially", () => {
      const err1 = /** @type {CommonError} */ (new Error("Error 1"));
      err1.statusCode = 400;

      const err2 = /** @type {CommonError} */ (new Error("Error 2"));
      err2.statusCode = 500;

      const res2 = createMockResponse();

      errorHandler(err1, req, res, next);
      errorHandler(err2, req, res2, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 400,
        error: "Bad Request",
        message: "Error 1",
      });

      expect(res2.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: 500,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });

      expect(loggerMock.error).toHaveBeenCalledTimes(1); // Only for 500 error
    });
  });
});
