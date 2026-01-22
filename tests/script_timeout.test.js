import { describe, test, expect } from "@jest/globals";
import { createMiddlewareTestContext } from "./helpers/middleware-test-utils.js";

// Mock Apify and Axios
import { setupCommonMocks } from "./helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true });

describe("Custom Script Timeout", () => {
  test("Should terminate infinite loop script within 1s", async () => {
    // We'll create a fresh middleware with a dangerous script
    const dangerousScript = "while(true) {}";
    const webhookId = "wh_test_123";

    const ctx = await createMiddlewareTestContext({
      options: {
        customScript: dangerousScript,
        authKey: "secret",
      },
      request: {
        params: { id: webhookId },
        query: { key: "secret" },
        body: { test: "infinite" },
        headers: { "content-type": "application/json" },
      },
    });

    const startTime = Date.now();
    await ctx.middleware(ctx.req, ctx.res, ctx.next);
    const duration = Date.now() - startTime;

    // Response should be sent despite the script error
    expect(ctx.res.statusCode).toBe(200);
    // Script should have been terminated around 1s
    expect(duration).toBeGreaterThanOrEqual(1000);
    expect(duration).toBeLessThan(2000);
  }, 5000);
});
