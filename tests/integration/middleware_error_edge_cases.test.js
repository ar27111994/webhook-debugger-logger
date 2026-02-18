import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "../setup/helpers/test-utils.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { HTTP_STATUS, HTTP_STATUS_MESSAGES } from "../../src/consts/index.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 * @typedef {import("express").ErrorRequestHandler} ErrorRequestHandler
 */

// Setup logger mock before importing error middleware
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
await setupCommonMocks({ logger: true });

const { createErrorHandler } = await import("../../src/middleware/error.js");
import { ERROR_LABELS } from "../../src/consts/errors.js";

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
      err.statusCode = HTTP_STATUS.NOT_FOUND;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.NOT_FOUND,
        error: ERROR_LABELS.NOT_FOUND,
        message: "Test error",
      });
    });

    test("should use err.status if statusCode not present", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.status = HTTP_STATUS.FORBIDDEN;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.FORBIDDEN,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.FORBIDDEN],
        message: "Test error",
      });
    });

    test("should default to HTTP_STATUS.INTERNAL_SERVER_ERROR if no status info", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
      });
    });

    test("should prefer statusCode over status", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.statusCode = HTTP_STATUS.BAD_REQUEST;
      err.status = HTTP_STATUS.INTERNAL_SERVER_ERROR;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    });

    test("should use 'unknown' when requestId is missing", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const reqNoId = createMockRequest();
      // @ts-expect-error - testing missing property
      reqNoId.requestId = undefined;

      errorHandler(err, reqNoId, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "unknown",
        }),
      );
    });
  });

  describe("Server Error Sanitization (5xx)", () => {
    test("should log server errors to structured logger", () => {
      const err = /** @type {CommonError} */ (
        new Error("Internal database error")
      );
      err.statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

      errorHandler(err, req, res, next);

      // Source uses structured pino logging via log.error
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        }),
        "Server error",
      );
    });

    test("should sanitize error message for HTTP_STATUS.INTERNAL_SERVER_ERROR errors", () => {
      const err = /** @type {CommonError} */ (
        new Error("Database connection string: secret123")
      );
      err.statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR, // Sanitized, not original message
      });
    });

    test("should sanitize error message for HTTP_STATUS.BAD_GATEWAY errors", () => {
      const err = /** @type {CommonError} */ (new Error("Proxy error details"));
      err.statusCode = HTTP_STATUS.BAD_GATEWAY;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.BAD_GATEWAY,
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
      });
    });

    test("should sanitize error message for HTTP_STATUS.SERVICE_UNAVAILABLE errors", () => {
      const err = /** @type {CommonError} */ (new Error("Service details"));
      err.statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
      });
    });

    test("should log err.stack if available", () => {
      const err = /** @type {CommonError} */ (new Error("Test error"));
      err.statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
      err.stack = "Error: Test error\n    at file.js:10:5";

      errorHandler(err, req, res, next);
      // Source uses structured pino logging with serialized error
      // Note: The mock serializeError extracts message from Error instances
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            stack: err.stack,
          }),
          status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        }),
        "Server error",
      );
    });

    test("should log err.message if no stack", () => {
      const err = /** @type {CommonError} */ ({
        message: "Test error",
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      });

      errorHandler(err, req, res, next);
      // Source uses structured pino logging with serialized error
      // Plain objects passed to serializeError mock are serialized differently
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            message: err.message,
          }),
          status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        }),
        "Server error",
      );
    });

    test("should log err object if no message or stack", () => {
      const err = /** @type {CommonError} */ ({
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
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
    test("should return original message for HTTP_STATUS.BAD_REQUEST errors", () => {
      const err = /** @type {CommonError} */ (new Error("Invalid JSON"));
      err.statusCode = HTTP_STATUS.BAD_REQUEST;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.BAD_REQUEST,
        error: ERROR_LABELS.BAD_REQUEST,
        message: "Invalid JSON",
      });
    });

    test("should return original message for 401 errors", () => {
      const err = /** @type {CommonError} */ (
        new Error("Authentication required")
      );
      err.statusCode = HTTP_STATUS.UNAUTHORIZED;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.UNAUTHORIZED,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.UNAUTHORIZED],
        message: "Authentication required",
      });
    });

    test("should return specific error for 413 errors", () => {
      const err = /** @type {CommonError} */ (
        new Error("Payload exceeds limit")
      );
      err.statusCode = HTTP_STATUS.PAYLOAD_TOO_LARGE;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.PAYLOAD_TOO_LARGE,
        error: ERROR_LABELS.PAYLOAD_TOO_LARGE,
        message: "Payload exceeds limit",
      });
    });

    test("should return specific error for HTTP_STATUS.NOT_FOUND errors", () => {
      const err = /** @type {CommonError} */ (new Error("Resource not found"));
      err.statusCode = HTTP_STATUS.NOT_FOUND;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.NOT_FOUND,
        error: ERROR_LABELS.NOT_FOUND,
        message: "Resource not found",
      });
    });

    test("should return generic 'Client Error' for other 4xx", () => {
      const err = /** @type {CommonError} */ (new Error("Conflict"));
      err.statusCode = HTTP_STATUS.CONFLICT;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.CONFLICT,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.CONFLICT],
        message: "Conflict",
      });
    });

    test("should NOT log 4xx errors to structured logger", () => {
      const err = /** @type {CommonError} */ (new Error("Not found"));
      err.statusCode = HTTP_STATUS.NOT_FOUND;

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
      err.statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

      errorHandler(err, req, res, next);

      expect(loggerMock.error).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe("Error Object Variations", () => {
    test("should handle Error instance", () => {
      const err = /** @type {CommonError} */ (new Error("Standard error"));
      err.statusCode = HTTP_STATUS.BAD_REQUEST;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.BAD_REQUEST,
        error: ERROR_LABELS.BAD_REQUEST,
        message: "Standard error",
      });
    });

    test("should handle TypeError", () => {
      const err = /** @type {CommonError} */ (
        new TypeError("Cannot read property")
      );
      err.statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
      });
    });

    test("should handle RangeError", () => {
      const err = /** @type {CommonError} */ (new RangeError("Invalid range"));
      err.statusCode = HTTP_STATUS.BAD_REQUEST;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.BAD_REQUEST,
        error: ERROR_LABELS.BAD_REQUEST,
        message: "Invalid range",
      });
    });

    test("should handle plain object error", () => {
      const err = /** @type {CommonError} */ ({
        message: "Plain object error",
        statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      });

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.UNPROCESSABLE_ENTITY],
        message: "Plain object error",
      });
    });

    test("should handle error with no message property", () => {
      const err = /** @type {CommonError} */ ({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        // No message
      });

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.BAD_REQUEST,
        error: ERROR_LABELS.BAD_REQUEST,
        message: undefined,
      });
    });

    test("should handle error with empty message", () => {
      const err = /** @type {CommonError} */ (new Error(""));
      err.statusCode = HTTP_STATUS.BAD_REQUEST;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.BAD_REQUEST,
        error: ERROR_LABELS.BAD_REQUEST,
        message: "",
      });
    });
  });

  describe("Edge Status Codes", () => {
    test("should handle status 0 (falsy, defaults to HTTP_STATUS.INTERNAL_SERVER_ERROR)", () => {
      const err = /** @type {CommonError} */ (new Error("Zero status"));
      err.statusCode = 0;

      errorHandler(err, req, res, next);

      // Status 0 is falsy, so defaults to HTTP_STATUS.INTERNAL_SERVER_ERROR
      expect(res.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
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
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
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
        error: ERROR_LABELS.GENERIC,
        message: "Negative status",
      });
    });

    test("should handle 1xx status codes", () => {
      const err = /** @type {CommonError} */ (new Error("Informational"));
      err.statusCode = HTTP_STATUS.CONTINUE;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.CONTINUE,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.CONTINUE],
        message: "Informational",
      });
    });

    test("should handle 2xx status codes (unusual for errors)", () => {
      const err = /** @type {CommonError} */ (new Error("Success error"));
      err.statusCode = HTTP_STATUS.OK;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.OK,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
        message: "Success error",
      });
    });

    test("should handle 3xx status codes", () => {
      const err = /** @type {CommonError} */ (new Error("Redirect error"));
      err.statusCode = HTTP_STATUS.FOUND;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.FOUND,
        error: HTTP_STATUS_MESSAGES[HTTP_STATUS.FOUND],
        message: "Redirect error",
      });
    });
  });

  describe("Response Method Chaining", () => {
    test("should properly chain status() and json()", () => {
      const err = /** @type {CommonError} */ (new Error("Test"));
      err.statusCode = HTTP_STATUS.BAD_REQUEST;

      errorHandler(err, req, res, next);

      // Verify status was called first
      expect(jest.mocked(res.status).mock.results[0].value).toBe(res);
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("Concurrent Error Handling", () => {
    test("should handle multiple errors sequentially", () => {
      const err1 = /** @type {CommonError} */ (new Error("Error 1"));
      err1.statusCode = HTTP_STATUS.BAD_REQUEST;

      const err2 = /** @type {CommonError} */ (new Error("Error 2"));
      err2.statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const res2 = createMockResponse();

      errorHandler(err1, req, res, next);
      errorHandler(err2, req, res2, next);

      expect(res.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.BAD_REQUEST,
        error: ERROR_LABELS.BAD_REQUEST,
        message: "Error 1",
      });

      expect(res2.json).toHaveBeenCalledWith({
        requestId: "test_req_123",
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        error: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
      });

      expect(loggerMock.error).toHaveBeenCalledTimes(1); // Only for HTTP_STATUS.INTERNAL_SERVER_ERROR error
    });
  });
});
