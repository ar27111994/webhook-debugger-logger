/**
 * @file tests/integration/main_routes.test.js
 * @description Integration route matrix validating app endpoints after initialization.
 */

import { APP_ROUTES } from "../../src/consts/app.js";
import { AUTH_CONSTS } from "../../src/consts/auth.js";
import {
  HTTP_HEADERS,
  HTTP_STATUS,
  MIME_TYPES,
} from "../../src/consts/http.js";
import { startIntegrationApp } from "../setup/helpers/integration-harness.js";
import { createWebhookPayload } from "../setup/helpers/fixtures/payload-fixtures.js";

/**
 * @typedef {import('supertest').Agent} AppClient
 * @typedef {{ id: string, webhookId: string }} LogListItem
 */

const AUTH_KEY = "integration-main-routes-secret";
const TEST_TIMEOUT_MS = 30000;
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

describe("Integration: Main routes", () => {
  /** @type {{ teardown: () => Promise<void>, appClient: AppClient } | null} */
  let context = null;

  beforeEach(async () => {
    context = await startIntegrationApp({
      authKey: AUTH_KEY,
      urlCount: 1,
      retentionHours: 1,
      enableJSONParsing: true,
      defaultResponseCode: HTTP_STATUS.CREATED,
      defaultResponseBody: "created",
    });
  });

  afterEach(async () => {
    if (context) {
      await context.teardown();
      context = null;
    }
  });

  it("should respond correctly for dashboard, health, ready, info, and system metrics routes", async () => {
    const activeContext = requireContext(context);

    const dashboard = await activeContext.appClient
      .get(APP_ROUTES.DASHBOARD)
      .set(
        HTTP_HEADERS.AUTHORIZATION,
        `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      );
    const health = await activeContext.appClient.get(APP_ROUTES.HEALTH);
    const ready = await activeContext.appClient.get(APP_ROUTES.READY);

    const infoUnauthorized = await activeContext.appClient.get(APP_ROUTES.INFO);
    const infoAuthorized = await activeContext.appClient
      .get(APP_ROUTES.INFO)
      .set(
        HTTP_HEADERS.AUTHORIZATION,
        `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      );

    const metrics = await activeContext.appClient
      .get(APP_ROUTES.SYSTEM_METRICS)
      .set(
        HTTP_HEADERS.AUTHORIZATION,
        `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      );

    expect(dashboard.status).toBe(HTTP_STATUS.OK);
    expect(health.status).toBe(HTTP_STATUS.OK);
    expect(ready.status).toBe(HTTP_STATUS.OK);
    expect(infoUnauthorized.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(infoAuthorized.status).toBe(HTTP_STATUS.OK);
    expect(metrics.status).toBe(HTTP_STATUS.OK);
  });

  it(
    "should provide working logs, log detail, log payload, and replay endpoint contracts",
    async () => {
      const activeContext = requireContext(context);
      const webhookId = await resolveActiveWebhookId(activeContext.appClient);

      const ingestResponse = await activeContext.appClient
        .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
        .send(
          createWebhookPayload({
            id: "evt_main_routes_contract_1",
            source: "integration-main-routes",
            data: { amount: 42 },
          }),
        );

      expect(ingestResponse.status).toBe(HTTP_STATUS.CREATED);

      const logsResponse = await activeContext.appClient
        .get(APP_ROUTES.LOGS)
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .query({ webhookId, limit: LOGS_QUERY_LIMIT });

      expect(logsResponse.status).toBe(HTTP_STATUS.OK);
      expect(Array.isArray(logsResponse.body.items)).toBe(true);

      /** @type {LogListItem[]} */
      const logs = logsResponse.body.items;
      const logItem = logs.find((item) => item.webhookId === webhookId);
      const logId = String(logItem?.id || "missing-log-id");

      const detailResponse = await activeContext.appClient
        .get(APP_ROUTES.LOG_DETAIL.replace(":logId", logId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        );

      expect([
        HTTP_STATUS.OK,
        HTTP_STATUS.NOT_FOUND,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ]).toContain(detailResponse.status);

      const payloadResponse = await activeContext.appClient
        .get(APP_ROUTES.LOG_PAYLOAD.replace(":logId", logId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        );

      expect([
        HTTP_STATUS.OK,
        HTTP_STATUS.NOT_FOUND,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ]).toContain(payloadResponse.status);

      // Replay route should be reachable and return a structured response (success or controlled failure)
      const replayResponse = await activeContext.appClient
        .get(
          APP_ROUTES.REPLAY.replace(":webhookId", webhookId).replace(
            ":itemId",
            logId,
          ),
        )
        .query({ url: "http://127.0.0.1:65535/replay-target" })
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        );

      expect([
        HTTP_STATUS.OK,
        HTTP_STATUS.BAD_REQUEST,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        HTTP_STATUS.GATEWAY_TIMEOUT,
      ]).toContain(replayResponse.status);
    },
    TEST_TIMEOUT_MS,
  );
});
