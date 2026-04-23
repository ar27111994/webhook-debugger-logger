/**
 * @file tests/integration/security.sanitation.integration.test.js
 * @description Integration security and sanitation matrix for auth and malformed payload handling.
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";

await setupCommonMocks({
  logger: true,
  apify: true,
  fs: true,
  db: false,
});

const { APP_ROUTES } = await import("../../src/consts/app.js");
const { HTTP_HEADERS, HTTP_METHODS, HTTP_STATUS, MIME_TYPES } =
  await import("../../src/consts/http.js");
const { startIntegrationApp } =
  await import("../setup/helpers/integration-harness.js");
const { createMalformedPayloadFixtures, createWebhookPayload } =
  await import("../setup/helpers/fixtures/payload-fixtures.js");
const { waitForCondition } = await import("../setup/helpers/test-utils.js");
const { AUTH_CONSTS } = await import("../../src/consts/auth.js");

/**
 * @typedef {import('supertest').Agent} AppClient
 * @typedef {import('../../src/typedefs.js').LogEntry} LogEntry
 */

const AUTH_KEY = "integration-security-secret";
const SECURITY_SANITATION_TEST_TIMEOUT_MS = 15000;
const LOG_SYNC_WAIT_TIMEOUT_MS = 5000;
const LOG_SYNC_WAIT_INTERVAL_MS = 100;
const LOGS_QUERY_LIMIT = 50;

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
      customScript: undefined,
      jsonSchema: undefined,
    });
  }, SECURITY_SANITATION_TEST_TIMEOUT_MS);

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

      expect(response.status).toBeGreaterThanOrEqual(HTTP_STATUS.OK);
      expect(response.status).toBeLessThan(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      expect(String(response.text)).not.toContain("at ");
      expect(String(response.text)).not.toContain("node:");

      if (fixture.label === "invalid_json") {
        await waitForCondition(
          async () => {
            const logsResponse = await activeContext.appClient
              .get(APP_ROUTES.LOGS)
              .set(
                HTTP_HEADERS.AUTHORIZATION,
                `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
              )
              .query({ webhookId, limit: LOGS_QUERY_LIMIT });

            if (logsResponse.status !== HTTP_STATUS.OK) {
              return false;
            }

            /** @type {LogEntry[]} */
            const items = Array.isArray(logsResponse.body?.items)
              ? logsResponse.body.items
              : [];

            return items.some(
              (item) =>
                item.webhookId === webhookId &&
                String(item.body).includes(fixture.body),
            );
          },
          LOG_SYNC_WAIT_TIMEOUT_MS,
          LOG_SYNC_WAIT_INTERVAL_MS,
        );

        const logsResponse = await activeContext.appClient
          .get(APP_ROUTES.LOGS)
          .set(
            HTTP_HEADERS.AUTHORIZATION,
            `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          )
          .query({ webhookId, limit: LOGS_QUERY_LIMIT });

        expect(logsResponse.status).toBe(HTTP_STATUS.OK);

        /** @type {LogEntry[]} */
        const items = Array.isArray(logsResponse.body?.items)
          ? logsResponse.body.items
          : [];
        const createdItem = items.find(
          (item) =>
            item.webhookId === webhookId &&
            String(item.body).includes(fixture.body),
        );

        expect(createdItem).toBeDefined();
        expect(String(createdItem?.body)).toContain(fixture.body);
      }
    }
  });
});
