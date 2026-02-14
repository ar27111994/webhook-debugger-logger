import { describe, test, expect } from "@jest/globals";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";
import {
  HTTP_STATUS,
  APP_CONSTS,
  HTTP_HEADERS,
  MIME_TYPES,
} from "../../src/consts/index.js";
const { SCRIPT_EXECUTION_TIMEOUT_MS } = APP_CONSTS;

// Mock Apify and Axios
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true });

describe("Custom Script Timeout", () => {
  test(
    `Should terminate infinite loop script within ${SCRIPT_EXECUTION_TIMEOUT_MS / 1000}s`,
    async () => {
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
          headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
        },
      });

      const startTime = Date.now();
      await ctx.middleware(ctx.req, ctx.res, ctx.next);
      const duration = Date.now() - startTime;

      // Response should be sent despite the script error
      expect(ctx.res.statusCode).toBe(HTTP_STATUS.OK);
      // Script should have been terminated around 1s
      expect(duration).toBeGreaterThanOrEqual(SCRIPT_EXECUTION_TIMEOUT_MS);
      expect(duration).toBeLessThan(SCRIPT_EXECUTION_TIMEOUT_MS * 2);
    },
    SCRIPT_EXECUTION_TIMEOUT_MS * 5,
  );
});
