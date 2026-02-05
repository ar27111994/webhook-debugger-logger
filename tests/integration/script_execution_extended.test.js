import { describe, test, expect } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

// Mock Apify, Axios, and Logger
await setupCommonMocks({ axios: true, apify: true, logger: true });

const { SCRIPT_EXECUTION_TIMEOUT_MS } = await import("../../src/consts.js");

describe("Script Execution Extended", () => {
  useMockCleanup();

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

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    // Source uses structured pino logging via this.#log.error
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: "wh_123",
        isTimeout: true,
      }),
      expect.stringContaining(
        `Custom script execution timed out after ${SCRIPT_EXECUTION_TIMEOUT_MS}ms`,
      ),
    );
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

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    // Source uses structured pino logging via this.#log.error with "Failed to run custom script"
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: "wh_123",
        isTimeout: false,
        err: expect.objectContaining({
          message: expect.stringContaining("Boom"),
        }),
      }),
      "Failed to run custom script",
    );
  });
});
