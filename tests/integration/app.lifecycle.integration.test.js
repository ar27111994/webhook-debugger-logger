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
import { HTTP_STATUS } from "../../src/consts/http.js";

/**
 * @typedef {import('supertest').Agent} AppClient
 */

await setupCommonMocks({
  logger: true,
  apify: true,
  fs: false,
  db: false,
});

describe("Integration: App lifecycle and auth boundaries", () => {
  useMockCleanup();
  const AUTH_KEY = "integration-secret";
  const APP_LIFECYCLE_TEST_TIMEOUT_MS = 15000;
  const APP_LIFECYCLE_CYCLE_COUNT = 3;

  /** @type {{ teardown: () => Promise<void>, appClient: AppClient } | null} */
  let context = null;

  afterEach(async () => {
    if (context) {
      await context.teardown();
      context = null;
    }
  });

  it(
    "should expose health endpoint without authentication",
    async () => {
      context = await startIntegrationApp({ authKey: AUTH_KEY });

      const response = await context.appClient.get(APP_ROUTES.HEALTH);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.text.length).toBeGreaterThan(0);
    },
    APP_LIFECYCLE_TEST_TIMEOUT_MS,
  );

  it(
    "should require bearer token for protected info endpoint",
    async () => {
      context = await startIntegrationApp({ authKey: AUTH_KEY });

      const unauthorizedResponse = await context.appClient.get(APP_ROUTES.INFO);
      const authorizedResponse = await context.appClient
        .get(APP_ROUTES.INFO)
        .set(createBearerAuthHeader(AUTH_KEY));

      expect(unauthorizedResponse.status).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(authorizedResponse.status).toBe(HTTP_STATUS.OK);
    },
    APP_LIFECYCLE_TEST_TIMEOUT_MS,
  );

  it(
    "should not bypass auth for protected endpoints when the readiness header is present",
    async () => {
      context = await startIntegrationApp({ authKey: AUTH_KEY });

      const readinessResponse = await context.appClient
        .get(APP_ROUTES.INFO)
        .set(createReadinessProbeHeader());

      expect(readinessResponse.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    },
    APP_LIFECYCLE_TEST_TIMEOUT_MS,
  );

  it(
    "should survive repeated start and teardown cycles without leaking route or auth state",
    async () => {
      for (
        let cycleIndex = 0;
        cycleIndex < APP_LIFECYCLE_CYCLE_COUNT;
        cycleIndex++
      ) {
        context = await startIntegrationApp({ authKey: AUTH_KEY });

        const healthResponse = await context.appClient.get(APP_ROUTES.HEALTH);
        const unauthorizedInfoResponse = await context.appClient.get(
          APP_ROUTES.INFO,
        );
        const authorizedInfoResponse = await context.appClient
          .get(APP_ROUTES.INFO)
          .set(createBearerAuthHeader(AUTH_KEY));

        expect(healthResponse.status).toBe(HTTP_STATUS.OK);
        expect(unauthorizedInfoResponse.status).toBe(HTTP_STATUS.UNAUTHORIZED);
        expect(authorizedInfoResponse.status).toBe(HTTP_STATUS.OK);

        await context.teardown();
        context = null;
      }
    },
    APP_LIFECYCLE_TEST_TIMEOUT_MS,
  );
});
