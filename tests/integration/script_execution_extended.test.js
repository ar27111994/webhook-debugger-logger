import { jest, describe, test, expect } from "@jest/globals";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";

// Mock Apify and Axios
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true });

describe("Script Execution Extended", () => {
  test("should handle script timeout (infinite loop)", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        customScript: "while(true) {}",
        maxPayloadSize: 1024,
        allowedIps: [],
        authKey: "abc",
      },
      request: {
        params: { id: "wh_123" },
        query: { key: "abc" },
      },
    });

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await ctx.middleware(ctx.req, ctx.res, ctx.next);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SCRIPT-EXEC-ERROR]"),
        expect.stringContaining("Script execution timed out after"),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test("should handle script execution error", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        customScript: "throw new Error('Boom')",
        maxPayloadSize: 1024,
        allowedIps: [],
        authKey: "abc",
      },
      request: {
        params: { id: "wh_123" },
        query: { key: "abc" },
      },
    });

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await ctx.middleware(ctx.req, ctx.res, ctx.next);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SCRIPT-EXEC-ERROR]"),
        "Boom",
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
