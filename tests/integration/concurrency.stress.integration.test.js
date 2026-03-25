/**
 * @file tests/integration/concurrency.stress.integration.test.js
 * @description Integration concurrency suite for burst webhook ingestion and log persistence.
 */

import { APP_ROUTES } from "../../src/consts/app.js";
import {
  HTTP_HEADERS,
  HTTP_STATUS,
  MIME_TYPES,
} from "../../src/consts/http.js";
import { startIntegrationApp } from "../setup/helpers/integration-harness.js";
import { createWebhookPayload } from "../setup/helpers/fixtures/payload-fixtures.js";
import { waitForCondition } from "../setup/helpers/test-utils.js";
import { AUTH_CONSTS } from "../../src/consts/index.js";

/**
 * @typedef {import('supertest').Agent} AppClient
 */

const AUTH_KEY = "integration-concurrency-secret";
const BURST_SIZE = 12;
const BURST_BASE_AMOUNT = 1000;
const BURST_LOG_SYNC_TIMEOUT_MS = 10000;
const BURST_LOG_SYNC_INTERVAL_MS = 150;

/**
 * @typedef {{ webhookId: string }} WebhookLogItem
 */

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

describe("Integration: Concurrency burst ingestion", () => {
  /** @type {{ teardown: () => Promise<void>, appClient: AppClient } | null} */
  let context = null;

  afterEach(async () => {
    if (context) {
      await context.teardown();
      context = null;
    }
  });

  it("should handle burst ingest traffic and surface all events in /logs", async () => {
    context = await startIntegrationApp({
      authKey: AUTH_KEY,
      urlCount: 1,
      retentionHours: 1,
      enableJSONParsing: true,
      defaultResponseCode: HTTP_STATUS.ACCEPTED,
    });
    const activeContext = requireContext(context);

    const webhookId = await resolveActiveWebhookId(activeContext.appClient);

    const requests = Array.from({ length: BURST_SIZE }).map((_, index) =>
      activeContext.appClient
        .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
        .send(
          createWebhookPayload({
            id: `evt_burst_${index}`,
            event: "burst.accepted",
            data: {
              index,
              amount: BURST_BASE_AMOUNT + index,
              currency: "USD",
            },
          }),
        ),
    );

    const responses = await Promise.all(requests);
    responses.forEach((response) => {
      expect(response.status).toBe(HTTP_STATUS.ACCEPTED);
    });

    await waitForCondition(
      async () => {
        const logsResponse = await activeContext.appClient
          .get(APP_ROUTES.LOGS)
          .set(
            HTTP_HEADERS.AUTHORIZATION,
            `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          )
          .query({ webhookId, limit: 100 });

        if (logsResponse.status !== HTTP_STATUS.OK) {
          return false;
        }

        /** @type {WebhookLogItem[]} */
        const items = Array.isArray(logsResponse.body?.items)
          ? logsResponse.body.items
          : [];

        return (
          items.filter((item) => item.webhookId === webhookId).length >=
          BURST_SIZE
        );
      },
      BURST_LOG_SYNC_TIMEOUT_MS,
      BURST_LOG_SYNC_INTERVAL_MS,
    );

    const finalLogsResponse = await activeContext.appClient
      .get(APP_ROUTES.LOGS)
      .set(
        HTTP_HEADERS.AUTHORIZATION,
        `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      )
      .query({ webhookId, limit: 100 });

    expect(finalLogsResponse.status).toBe(HTTP_STATUS.OK);

    /** @type {WebhookLogItem[]} */
    const finalItems = finalLogsResponse.body.items;
    const webhookLogs = finalItems.filter(
      (item) => item.webhookId === webhookId,
    );

    expect(webhookLogs.length).toBeGreaterThanOrEqual(BURST_SIZE);
  });
});
