/**
 * @file tests/unit/middleware/middleware_security.test.js
 * @description Unit tests for the security middleware including Request ID and CSP headers.
 */

import { jest } from "@jest/globals";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "../../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../../src/typedefs.js').CustomRequest} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 */

import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import { ENCODINGS } from "../../../src/consts/http.js";
await setupCommonMocks();
const { createRequestIdMiddleware, createCspMiddleware } =
  await import("../../../src/middleware/security.js");
const { REQUEST_ID_PREFIX } = await import("../../../src/consts/app.js");
const { HTTP_HEADERS, MIME_TYPES, HTTP_STATUS } =
  await import("../../../src/consts/http.js");
const { SECURITY_CONSTS, SECURITY_HEADERS_VALUES } =
  await import("../../../src/consts/security.js");

describe("Security Middleware", () => {
  /** @type {Request} */
  let mockReq;
  /** @type {Response} */
  let mockRes;
  /** @type {NextFunction} */
  let mockNext;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockReq.headers = {}; // clear explicitly
    mockRes = createMockResponse();
    mockNext = createMockNextFunction();
    jest.clearAllMocks();
  });

  describe("createRequestIdMiddleware", () => {
    /** @type {RequestHandler} */
    let middleware;
    beforeEach(() => {
      middleware = createRequestIdMiddleware();
    });

    it("should generate a new request ID if none is provided", () => {
      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).toBeDefined();
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.X_REQUEST_ID,
        mockReq.requestId,
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it("should generate a new request ID if the provided string is an invalid UUID", () => {
      const INVALID_ID = "invalid-id";
      mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = INVALID_ID;

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).not.toBe(INVALID_ID);
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });

    it("should ignore a valid lowercase request ID header and generate a new server ID", () => {
      const validUUID = "123e4567-e89b-12d3-a456-426614174000";
      mockReq.headers[HTTP_HEADERS.X_REQUEST_ID.toLowerCase()] = validUUID;

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).not.toBe(validUUID);
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });

    it("should ignore an array header value and keep the generated request ID", () => {
      const validUUID = "123e4567-e89b-12d3-a456-426614174001";
      mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = [validUUID, "second-val"];

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).not.toBe(validUUID);
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });

    it("should ignore a prefixed request ID header and generate a new server ID", () => {
      const uuidWithoutPrefix = "123e4567-e89b-12d3-a456-426614174002";
      mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] =
        `${REQUEST_ID_PREFIX}${uuidWithoutPrefix}`;

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).not.toBe(
        `${REQUEST_ID_PREFIX}${uuidWithoutPrefix}`,
      );
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });

    it("should handle an empty string provided in the headers cleanly", () => {
      mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = "";

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).toBeDefined();
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });

    it("should handle an empty array provided in the headers cleanly", () => {
      mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = [];

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).toBeDefined();
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });

    it("should safely process and truncate or reject excessively large Request ID inputs (ReDOS defense check)", () => {
      const HUGE_ID_LENGTH = 20000;
      const hugeId = "a".repeat(HUGE_ID_LENGTH);
      mockReq.headers[HTTP_HEADERS.X_REQUEST_ID] = hugeId;

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.requestId).toBeDefined();
      // Should generate a NEW ID because a string of 'a's will fail validation
      expect(mockReq.requestId).not.toBe(hugeId);
      expect(String(mockReq.requestId).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });
  });

  describe("createCspMiddleware", () => {
    /** @type {RequestHandler} */
    let middleware;
    beforeEach(() => {
      middleware = createCspMiddleware();
    });

    it("should apply universal security headers immediately", () => {
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.X_CONTENT_TYPE_OPTIONS,
        SECURITY_HEADERS_VALUES.NOSNIFF,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.X_FRAME_OPTIONS,
        SECURITY_HEADERS_VALUES.DENY,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.REFERRER_POLICY,
        SECURITY_HEADERS_VALUES.REF_STRICT_ORIGIN,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.STRICT_TRANSPORT_SECURITY,
        SECURITY_HEADERS_VALUES.HSTS_VALUE,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.PERMISSIONS_POLICY,
        SECURITY_HEADERS_VALUES.PERMISSIONS_POLICY_VALUE,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should default to not applying CSP if getHeader returns nothing", () => {
      const originalWriteHead = mockRes.writeHead;
      middleware(mockReq, mockRes, mockNext);

      // Mock getHeader behavior
      jest.mocked(mockRes.getHeader).mockReturnValue(undefined);

      // Trigger writeHead wrap
      mockRes.writeHead(HTTP_STATUS.OK);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith(
        HTTP_HEADERS.CONTENT_SECURITY_POLICY,
        expect.anything(),
      );
      expect(originalWriteHead).toHaveBeenCalledWith(HTTP_STATUS.OK);
    });

    it("should not apply CSP if content type is not HTML", () => {
      const originalWriteHead = mockRes.writeHead;
      middleware(mockReq, mockRes, mockNext);

      jest.mocked(mockRes.getHeader).mockReturnValue(MIME_TYPES.JSON);
      mockRes.writeHead(HTTP_STATUS.OK, { some: "header" });

      expect(mockRes.setHeader).not.toHaveBeenCalledWith(
        HTTP_HEADERS.CONTENT_SECURITY_POLICY,
        expect.anything(),
      );
      expect(originalWriteHead).toHaveBeenCalledWith(HTTP_STATUS.OK, {
        some: "header",
      });
    });

    it("should apply CSP if content type is HTML", () => {
      const originalWriteHead = mockRes.writeHead;
      middleware(mockReq, mockRes, mockNext);

      jest
        .mocked(mockRes.getHeader)
        .mockReturnValue(`${MIME_TYPES.HTML}; charset=${ENCODINGS.UTF8}`);
      mockRes.writeHead(HTTP_STATUS.OK);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.CONTENT_SECURITY_POLICY,
        SECURITY_CONSTS.CSP_POLICY,
      );
      expect(originalWriteHead).toHaveBeenCalledWith(HTTP_STATUS.OK);
    });

    it("should emit a CSP policy without unsafe-inline allowances", () => {
      expect(SECURITY_CONSTS.CSP_POLICY).not.toContain("'unsafe-inline'");
    });

    it("should not double-wrap writeHead if middleware is called twice on the same response object", () => {
      // Note: The WeakSet tracks objects directly.
      middleware(mockReq, mockRes, mockNext);
      const wrappedWriteHead1 = mockRes.writeHead;

      middleware(mockReq, mockRes, mockNext);
      const wrappedWriteHead2 = mockRes.writeHead;

      // If it didn't double-wrap, the function reference should be identical
      expect(wrappedWriteHead1).toBe(wrappedWriteHead2);
    });
  });
});
