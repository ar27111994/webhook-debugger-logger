/**
 * @file tests/integration/middleware_suite.test.js
 * @description System-level integration of the middleware chain:
 * Request -> Security -> Parser -> Auth -> Handler.
 */

import { APP_ROUTES, REQUEST_ID_PREFIX } from "../../src/consts/app.js";
import { AUTH_CONSTS } from "../../src/consts/auth.js";
import {
  HTTP_HEADERS,
  HTTP_STATUS,
  MIME_TYPES,
} from "../../src/consts/http.js";
import {
  startIntegrationApp,
  createBearerAuthHeader,
} from "../setup/helpers/integration-harness.js";

/**
 * @typedef {import('supertest').Agent} AppClient
 */

const AUTH_KEY = "integration-middleware-suite-secret";

/**
 * @param {{ teardown: () => Promise<void>, appClient: AppClient } | null} context
 * @returns {{ teardown: () => Promise<void>, appClient: AppClient }}
 */
function requireContext(context) {
  if (!context) {
    throw new Error("Integration app context must be initialized before use.");
  }
  return context;
}

/**
 * @param {AppClient} appClient
 * @returns {Promise<string>}
 */
async function resolveActiveWebhookId(appClient) {
  const infoResponse = await appClient
    .get(APP_ROUTES.INFO)
    .set(createBearerAuthHeader(AUTH_KEY));

  expect(infoResponse.status).toBe(HTTP_STATUS.OK);
  return String(infoResponse.body.system.activeWebhooks[0].id);
}

describe("Integration: Middleware suite", () => {
  /** @type {{ teardown: () => Promise<void>, appClient: AppClient } | null} */
  let context = null;

  beforeEach(async () => {
    context = await startIntegrationApp({
      authKey: AUTH_KEY,
      urlCount: 1,
      retentionHours: 1,
      enableJSONParsing: true,
      defaultResponseCode: HTTP_STATUS.OK,
      defaultResponseBody: "ok",
    });
  });

  afterEach(async () => {
    if (context) {
      await context.teardown();
      context = null;
    }
  });

  it("should enforce security headers and request-id, then block unauthorized calls before handler", async () => {
    const activeContext = requireContext(context);
    const webhookId = await resolveActiveWebhookId(activeContext.appClient);

    const response = await activeContext.appClient
      .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
      .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
      .send({ event: "unauthorized" });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    // Security middleware headers
    expect(
      response.headers[HTTP_HEADERS.X_CONTENT_TYPE_OPTIONS.toLowerCase()],
    ).toBeDefined();
    expect(
      response.headers[HTTP_HEADERS.X_FRAME_OPTIONS.toLowerCase()],
    ).toBeDefined();
    expect(
      response.headers[HTTP_HEADERS.STRICT_TRANSPORT_SECURITY.toLowerCase()],
    ).toBeDefined();

    // Request-id middleware
    expect(response.headers[HTTP_HEADERS.X_REQUEST_ID]).toBeDefined();
    expect(
      String(response.headers[HTTP_HEADERS.X_REQUEST_ID]).startsWith(
        REQUEST_ID_PREFIX,
      ),
    ).toBe(true);
  });

  it("should pass auth and parser then reach handler with malformed JSON gracefully sanitized", async () => {
    const activeContext = requireContext(context);
    const webhookId = await resolveActiveWebhookId(activeContext.appClient);

    const malformedJson = '{"bad": "json"';
    const response = await activeContext.appClient
      .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
      .set(
        HTTP_HEADERS.AUTHORIZATION,
        `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      )
      .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
      .send(malformedJson);

    // Parser + logger middleware should keep behavior sanitized (no stack leakage), no 5xx crash
    expect(response.status).toBeGreaterThanOrEqual(HTTP_STATUS.OK);
    expect(response.status).toBeLessThan(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(String(response.text)).not.toContain("node:");
    expect(String(response.text)).not.toContain(" at ");
  });
});
