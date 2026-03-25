/**
 * @file tests/integration/app.lifecycle.integration.test.js
 * @description Integration tests for in-process app lifecycle and protected route behavior.
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  startIntegrationApp,
  createBearerAuthHeader,
  createReadinessProbeHeader,
} from "../setup/helpers/integration-harness.js";
import { APP_ROUTES } from "../../src/consts/app.js";
import { HTTP_CONSTS, HTTP_STATUS } from "../../src/consts/http.js";

/**
 * @typedef {import('supertest').Agent} AppClient
 */

await setupCommonMocks({
  logger: true,
  apify: true,
  fs: true,
  db: false,
});

describe("Integration: App lifecycle and auth boundaries", () => {
  useMockCleanup();
  const AUTH_KEY = "integration-secret";

  /** @type {{ teardown: () => Promise<void>, appClient: AppClient } | null} */
  let context = null;

  afterEach(async () => {
    if (context) {
      await context.teardown();
      context = null;
    }
  });

  it("should expose health endpoint without authentication", async () => {
    context = await startIntegrationApp({ authKey: AUTH_KEY });

    const response = await context.appClient.get(APP_ROUTES.HEALTH);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.text.length).toBeGreaterThan(0);
  });

  it("should require bearer token for protected info endpoint", async () => {
    context = await startIntegrationApp({ authKey: AUTH_KEY });

    const unauthorizedResponse = await context.appClient.get(APP_ROUTES.INFO);
    const authorizedResponse = await context.appClient
      .get(APP_ROUTES.INFO)
      .set(createBearerAuthHeader(AUTH_KEY));

    expect(unauthorizedResponse.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(authorizedResponse.status).toBe(HTTP_STATUS.OK);
  });

  it("should bypass auth for readiness probe header on protected endpoint", async () => {
    context = await startIntegrationApp({ authKey: AUTH_KEY });

    const readinessResponse = await context.appClient
      .get(APP_ROUTES.INFO)
      .set(createReadinessProbeHeader());

    expect(readinessResponse.status).toBe(HTTP_CONSTS.DEFAULT_RESPONSE_CODE);
    expect(readinessResponse.text).toBe(HTTP_CONSTS.DEFAULT_SUCCESS_BODY);
  });
});
