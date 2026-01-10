import { test, expect, describe } from "@jest/globals";
import { validateAuth } from "../src/utils/auth.js";

/** @typedef {import('express').Request} Request */

describe("Auth Unit Tests", () => {
  test("should reject multiple Authorization headers", () => {
    const req = /** @type {Request} */ ({
      headers: /** @type {any} */ ({
        authorization: ["Bearer key1", "Bearer key2"],
      }),
      query: {},
    });
    const result = validateAuth(req, "some-key");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Multiple Authorization headers are not allowed");
  });

  test("should allow valid single Authorization header", () => {
    const req = /** @type {Request} */ ({
      headers: {
        authorization: "Bearer my-secret-key",
      },
      query: {},
    });
    const result = validateAuth(req, "my-secret-key");
    expect(result.isValid).toBe(true);
  });
});
