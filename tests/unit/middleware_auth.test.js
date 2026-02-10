import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "../setup/helpers/test-utils.js";
import { HTTP_STATUS } from "../../src/consts/http.js";

// Setup mocks
await setupCommonMocks({ logger: true, auth: true });

// Mock auth utils
import { authMock as mockAuthUtils } from "../setup/helpers/shared-mocks.js";

const { createAuthMiddleware } = await import("../../src/middleware/auth.js");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 */

describe("Auth Middleware", () => {
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;
  const getAuthKey = jest.fn(() => "secret-key");

  beforeEach(() => {
    req = createMockRequest();
    res = createMockResponse();
    next = createMockNextFunction();
    mockAuthUtils.validateAuth.mockReset();
  });

  const handler = createAuthMiddleware(getAuthKey);

  test("should pass if readiness probe header is present", () => {
    req.headers["x-apify-container-server-readiness-probe"] = "1";
    handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
    expect(res.send).toHaveBeenCalledWith("OK");
    expect(next).not.toHaveBeenCalled();
  });

  test("should pass if validation succeeds", () => {
    mockAuthUtils.validateAuth.mockReturnValue({ isValid: true });
    handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockAuthUtils.validateAuth).toHaveBeenCalledWith(req, "secret-key");
  });

  test("should return JSON error if validation fails", () => {
    mockAuthUtils.validateAuth.mockReturnValue({
      isValid: false,
      error: "Invalid Key",
    });
    handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Unauthorized",
        message: "Invalid Key",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("should return HTML error if requested via browser", () => {
    mockAuthUtils.validateAuth.mockReturnValue({
      isValid: false,
      error: "Invalid Key",
    });
    req.headers["accept"] = "text/html,application/xhtml+xml";

    handler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("<!DOCTYPE html>"),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("Invalid Key"),
    );
  });
});
