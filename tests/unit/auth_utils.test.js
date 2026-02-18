import { test, expect, describe } from "@jest/globals";
import { validateAuth } from "../../src/utils/auth.js";
import { assertType, createMockRequest } from "../setup/helpers/test-utils.js";
import { AUTH_CONSTS, AUTH_ERRORS } from "../../src/consts/auth.js";

describe("Auth Unit Tests", () => {
  const authKey = "my-secret-key";

  test("should reject multiple Authorization headers", () => {
    const req = createMockRequest({
      headers: assertType({
        authorization: [
          AUTH_CONSTS.BEARER_PREFIX + "key1",
          AUTH_CONSTS.BEARER_PREFIX + "key2",
        ],
      }),
      query: {},
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(AUTH_ERRORS.MULTIPLE_HEADERS);
  });

  test("should allow proper single Authorization header in array", () => {
    // Branch coverage for Array.isArray check with length <= 1
    const req = createMockRequest({
      headers: assertType({
        authorization: [AUTH_CONSTS.BEARER_PREFIX + authKey],
      }),
      query: {},
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(true);
  });

  test("should allow valid single Authorization header (string)", () => {
    const req = createMockRequest({
      headers: {
        authorization: AUTH_CONSTS.BEARER_PREFIX + authKey,
      },
      query: {},
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(true);
  });

  test("should fail if no key provided in header or query", () => {
    const req = createMockRequest({
      headers: {},
      query: {},
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(AUTH_ERRORS.MISSING_KEY);
  });

  test("should fallback to query param if header missing", () => {
    const req = createMockRequest({
      headers: {},
      query: { key: authKey },
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(true);
  });

  test("should handle array in query params (take first)", () => {
    const req = createMockRequest({
      headers: {},
      query: assertType({ key: [authKey, "other"] }),
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(true);
  });

  test("should handle non-string query param by casting", () => {
    // If query param is number (e.g. ?key=123)
    const numKey = 12345;
    const req = createMockRequest({
      headers: {},
      query: assertType({ key: numKey }),
    });
    const result = validateAuth(req, String(numKey));
    expect(result.isValid).toBe(true);
  });

  test("should fail if key is incorrect", () => {
    const req = createMockRequest({
      headers: {
        authorization: AUTH_CONSTS.BEARER_PREFIX + "wrong-key",
      },
      query: {},
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(AUTH_ERRORS.UNAUTHORIZED_KEY);
  });

  test("should fail if key has incorrect prefix in header", () => {
    const req = createMockRequest({
      headers: {
        authorization: "Basic " + authKey,
      },
      query: {},
    });
    // Should fall through to query check and fail
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(AUTH_ERRORS.MISSING_KEY);
  });

  test("should bypass auth if no authKey configured", () => {
    const req = createMockRequest({
      headers: {},
      query: {},
    });
    const result = validateAuth(req, undefined);
    expect(result.isValid).toBe(true);
  });

  test("should handle empty array in Authorization header", () => {
    const req = createMockRequest({
      headers: assertType({
        authorization: [],
      }),
      query: {},
    });
    const result = validateAuth(req, authKey);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(AUTH_ERRORS.MISSING_KEY);
  });
});
