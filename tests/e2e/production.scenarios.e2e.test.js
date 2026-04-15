/**
 * @file tests/e2e/production.scenarios.e2e.test.js
 * @description E2E production-like scenario tests for spawned process ingest and log query.
 */

import { jest } from "@jest/globals";
import { APP_ROUTES } from "../../src/consts/app.js";
import { AUTH_CONSTS } from "../../src/consts/auth.js";
import {
  HTTP_HEADERS,
  HTTP_METHODS,
  HTTP_STATUS,
  MIME_TYPES,
} from "../../src/consts/http.js";
import {
  findFreePort,
  httpRequest,
  spawnAppProcess,
} from "../setup/helpers/e2e-process-harness.js";
import { createWebhookPayload } from "../setup/helpers/fixtures/payload-fixtures.js";
import { waitForCondition } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../setup/helpers/e2e-process-harness.js').SpawnedApp} SpawnedApp
 */

const AUTH_KEY = "e2e-production-secret";
const LOG_SYNC_WAIT_TIMEOUT_MS = 10000;
const LOG_SYNC_WAIT_INTERVAL_MS = 200;
const LOGS_QUERY_LIMIT = 100;
const E2E_TEST_TIMEOUT_MS = 20000;

jest.setTimeout(E2E_TEST_TIMEOUT_MS);

/**
 * @typedef {{ webhookId: string }} WebhookLogItem
 */

/**
 * @param {SpawnedApp | null} appProcess
 * @returns {SpawnedApp}
 */
function requireProcess(appProcess) {
  if (!appProcess) {
    throw new Error("Spawned app process must be available before use.");
  }
  return appProcess;
}

/**
 * @param {string} bodyText
 * @returns {any}
 */
function parseJsonBody(bodyText) {
  return JSON.parse(bodyText || "{}");
}

describe("E2E: Production scenarios", () => {
  /** @type {SpawnedApp | null} */
  let appProcess = null;

  afterEach(async () => {
    if (appProcess) {
      await appProcess.stop();
      appProcess = null;
    }
  });

  it("should complete auth -> ingest -> query logs flow in spawned process", async () => {
    const port = await findFreePort();
    appProcess = await spawnAppProcess({
      port,
      input: {
        urlCount: 1,
        retentionHours: 1,
        authKey: AUTH_KEY,
        enableJSONParsing: true,
      },
    });
    const activeProcess = requireProcess(appProcess);

    const infoResponse = await httpRequest(
      `${activeProcess.baseUrl}${APP_ROUTES.INFO}`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect(infoResponse.statusCode).toBe(HTTP_STATUS.OK);

    const infoBody = parseJsonBody(infoResponse.bodyText);
    const webhookId = String(infoBody.system.activeWebhooks[0].id);

    const ingestResponse = await fetch(
      `${activeProcess.baseUrl}${APP_ROUTES.WEBHOOK.replace(":id", webhookId)}`,
      {
        method: HTTP_METHODS.POST,
        headers: {
          [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
        },
        body: JSON.stringify(
          createWebhookPayload({
            id: "evt_e2e_prod_1",
            source: "e2e-production",
          }),
        ),
      },
    );

    expect(ingestResponse.status).toBe(HTTP_STATUS.OK);

    await waitForCondition(
      async () => {
        const logsResponse = await httpRequest(
          `${activeProcess.baseUrl}${APP_ROUTES.LOGS}?webhookId=${encodeURIComponent(webhookId)}&limit=${LOGS_QUERY_LIMIT}`,
          HTTP_METHODS.GET,
          {
            [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          },
        );

        if (logsResponse.statusCode !== HTTP_STATUS.OK) {
          return false;
        }

        const logsBody = parseJsonBody(logsResponse.bodyText);
        /** @type {WebhookLogItem[]} */
        const items = Array.isArray(logsBody.items) ? logsBody.items : [];
        return items.some((item) => item.webhookId === webhookId);
      },
      LOG_SYNC_WAIT_TIMEOUT_MS,
      LOG_SYNC_WAIT_INTERVAL_MS,
    );

    const finalLogsResponse = await httpRequest(
      `${activeProcess.baseUrl}${APP_ROUTES.LOGS}?webhookId=${encodeURIComponent(webhookId)}&limit=${LOGS_QUERY_LIMIT}`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect(finalLogsResponse.statusCode).toBe(HTTP_STATUS.OK);
    const finalLogsBody = parseJsonBody(finalLogsResponse.bodyText);
    expect(Array.isArray(finalLogsBody.items)).toBe(true);
    expect(finalLogsBody.items.length).toBeGreaterThan(0);
  });
});
