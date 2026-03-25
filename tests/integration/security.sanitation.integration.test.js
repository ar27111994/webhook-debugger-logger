/**
 * @file tests/integration/security.sanitation.integration.test.js
 * @description Integration security and sanitation matrix for auth and malformed payload handling.
 */

import { APP_ROUTES } from "../../src/consts/app.js";
import {
  HTTP_HEADERS,
  HTTP_METHODS,
  HTTP_STATUS,
  MIME_TYPES,
} from "../../src/consts/http.js";
import { startIntegrationApp } from "../setup/helpers/integration-harness.js";
import {
  createMalformedPayloadFixtures,
  createWebhookPayload,
} from "../setup/helpers/fixtures/payload-fixtures.js";
import { AUTH_CONSTS } from "../../src/consts/auth.js";

/**
 * @typedef {import('supertest').Agent} AppClient
 */

const AUTH_KEY = "integration-security-secret";

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
    .set(HTTP_HEADERS.AUTHORIZATION, `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`);

  expect(infoResponse.status).toBe(HTTP_STATUS.OK);
  return String(infoResponse.body.system.activeWebhooks[0].id);
}

describe("Integration: Security sanitation matrix", () => {
  /** @type {{ teardown: () => Promise<void>, appClient: AppClient } | null} */
  let context = null;

  beforeEach(async () => {
    context = await startIntegrationApp({
      authKey: AUTH_KEY,
      urlCount: 1,
      retentionHours: 1,
      enableJSONParsing: true,
    });
  });

  afterEach(async () => {
    if (context) {
      await context.teardown();
      context = null;
    }
  });

  it("should reject unauthorized webhook calls and unknown webhook ids", async () => {
    const activeContext = requireContext(context);
    const webhookId = await resolveActiveWebhookId(activeContext.appClient);

    const unauthorizedResponse = await activeContext.appClient
      .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
      .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
      .send(createWebhookPayload({ id: "evt_unauthorized" }));

    expect(unauthorizedResponse.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const invalidIdResponse = await activeContext.appClient
      .post(APP_ROUTES.WEBHOOK.replace(":id", "wh_invalid_999"))
      .set(
        HTTP_HEADERS.AUTHORIZATION,
        `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      )
      .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
      .send(createWebhookPayload({ id: "evt_invalid_id" }));

    expect(invalidIdResponse.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it("should sanitize malformed payload failures without leaking internals", async () => {
    const activeContext = requireContext(context);
    const webhookId = await resolveActiveWebhookId(activeContext.appClient);
    const malformedFixtures = createMalformedPayloadFixtures();

    for (const fixture of malformedFixtures) {
      const requestBuilder = activeContext.appClient
        .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .set(HTTP_HEADERS.CONTENT_TYPE, fixture.contentType);

      const response =
        fixture.method === HTTP_METHODS.POST
          ? await requestBuilder.send(fixture.body)
          : await requestBuilder;

      expect(response.status).toBeGreaterThanOrEqual(HTTP_STATUS.BAD_REQUEST);
      expect(response.status).toBeLessThan(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      expect(String(response.text)).not.toContain("at ");
      expect(String(response.text)).not.toContain("node:");
    }
  });
});
