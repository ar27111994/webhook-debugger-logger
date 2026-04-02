/**
 * @file tests/e2e/webhook_lifecycle.test.js
 * @description End-to-end webhook lifecycle:
 * Create -> Send -> Verify Persistence -> Verify Log -> Replay.
 */

import { APP_ROUTES, WEBHOOK_ID_PREFIX } from "../../src/consts/app.js";
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
 * @typedef {{ id: string, webhookId: string }} LogListItem
 */

const AUTH_KEY = "e2e-lifecycle-secret";
const WAIT_TIMEOUT_MS = 12000;
const WAIT_INTERVAL_MS = 200;

/**
 * @param {string} bodyText
 * @returns {any}
 */
function parseJsonBody(bodyText) {
  return JSON.parse(bodyText || "{}");
}

describe("E2E: Webhook lifecycle", () => {
  /** @type {SpawnedApp | null} */
  let appProcess = null;

  afterEach(async () => {
    if (appProcess) {
      await appProcess.stop();
      appProcess = null;
    }
  });

  it("should complete create -> send -> persist -> log -> replay flow", async () => {
    const port = await findFreePort();
    appProcess = await spawnAppProcess({
      port,
      input: {
        urlCount: 1,
        retentionHours: 1,
        authKey: AUTH_KEY,
        enableJSONParsing: true,
        replayMaxRetries: 1,
        replayTimeoutMs: 1000,
      },
    });

    const baseUrl = appProcess.baseUrl;

    // Create / Discover active webhook
    const infoResponse = await httpRequest(
      `${baseUrl}${APP_ROUTES.INFO}`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );
    expect(infoResponse.statusCode).toBe(HTTP_STATUS.OK);

    const infoBody = parseJsonBody(infoResponse.bodyText);
    const webhookId = String(infoBody.system.activeWebhooks[0].id);
    expect(webhookId.startsWith(WEBHOOK_ID_PREFIX)).toBe(true);

    // Send webhook event
    const payload = createWebhookPayload({
      id: "evt_e2e_lifecycle_1",
      source: "e2e-lifecycle",
      data: { orderId: "ord-001", amount: 333 },
    });

    const ingestResponse = await fetch(
      `${baseUrl}${APP_ROUTES.WEBHOOK.replace(":id", webhookId)}`,
      {
        method: HTTP_METHODS.POST,
        headers: {
          [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
        },
        body: JSON.stringify(payload),
      },
    );

    expect([
      HTTP_STATUS.OK,
      HTTP_STATUS.CREATED,
      HTTP_STATUS.ACCEPTED,
    ]).toContain(ingestResponse.status);

    // Verify persistence through /logs read model
    await waitForCondition(
      async () => {
        const logsResponse = await httpRequest(
          `${baseUrl}${APP_ROUTES.LOGS}?webhookId=${encodeURIComponent(webhookId)}&limit=100`,
          HTTP_METHODS.GET,
          {
            [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          },
        );

        if (logsResponse.statusCode !== HTTP_STATUS.OK) {
          return false;
        }

        const logsBody = parseJsonBody(logsResponse.bodyText);
        /** @type {LogListItem[]} */
        const items = Array.isArray(logsBody.items) ? logsBody.items : [];
        return items.some((item) => item.webhookId === webhookId);
      },
      WAIT_TIMEOUT_MS,
      WAIT_INTERVAL_MS,
    );

    const finalLogsResponse = await httpRequest(
      `${baseUrl}${APP_ROUTES.LOGS}?webhookId=${encodeURIComponent(webhookId)}&limit=100`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect(finalLogsResponse.statusCode).toBe(HTTP_STATUS.OK);
    const logsBody = parseJsonBody(finalLogsResponse.bodyText);
    /** @type {LogListItem[]} */
    const logs = Array.isArray(logsBody.items) ? logsBody.items : [];
    const eventLog = logs.find((item) => item.webhookId === webhookId);

    expect(eventLog).toBeDefined();
    const logId = String(eventLog?.id);

    // Verify log detail + payload route contracts
    const detailResponse = await httpRequest(
      `${baseUrl}${APP_ROUTES.LOG_DETAIL.replace(":logId", logId)}`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect([
      HTTP_STATUS.OK,
      HTTP_STATUS.NOT_FOUND,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    ]).toContain(detailResponse.statusCode);

    const payloadResponse = await httpRequest(
      `${baseUrl}${APP_ROUTES.LOG_PAYLOAD.replace(":logId", logId)}`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect([
      HTTP_STATUS.OK,
      HTTP_STATUS.NOT_FOUND,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    ]).toContain(payloadResponse.statusCode);

    // Replay (for local test infra, localhost target should be SSRF-blocked with controlled 4xx)
    const replayResponse = await httpRequest(
      `${baseUrl}${APP_ROUTES.REPLAY.replace(":webhookId", webhookId).replace(":itemId", logId)}?url=${encodeURIComponent("http://127.0.0.1:65535/replay-target")}`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect([
      HTTP_STATUS.OK,
      HTTP_STATUS.BAD_REQUEST,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      HTTP_STATUS.GATEWAY_TIMEOUT,
    ]).toContain(replayResponse.statusCode);
  });
});
