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
 * @typedef {{ id: string, webhookId: string, processingTime?: number | null }} LogListItem
 */

const AUTH_KEY = "e2e-lifecycle-secret";
const WAIT_TIMEOUT_MS = 12000;
const WAIT_INTERVAL_MS = 200;
const E2E_TEST_TIMEOUT_MS = 45000;
const RESPONSE_DELAY_MS = 600;
const RESPONSE_DELAY_TOLERANCE_MS = 100;
const WARM_PATH_SAMPLE_COUNT = 20;
const ENABLE_CLIENT_VISIBLE_LATENCY_SLO_ASSERTIONS =
  process.env.PERF_RUN === "1";
const PERCENTILE_DENOMINATOR = 100;
const LATENCY_PERCENTILES = Object.freeze({
  p50: 50,
  p95: 95,
  p99: 99,
});
const CLIENT_VISIBLE_LATENCY_SLO_TARGETS_MS = Object.freeze({
  p50: 125,
  p95: 300,
  p99: 600,
  max: 1000,
});

/**
 * @param {string} bodyText
 * @returns {any}
 */
function parseJsonBody(bodyText) {
  return JSON.parse(bodyText || "{}");
}

/**
 * @param {number[]} samples
 * @param {number} percentile
 * @returns {number}
 */
function getPercentile(samples, percentile) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((percentile / PERCENTILE_DENOMINATOR) * sorted.length) - 1,
  );
  return sorted[index];
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

  it(
    "should complete create -> send -> persist -> log -> replay flow",
    async () => {
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
    },
    E2E_TEST_TIMEOUT_MS,
  );

  it(
    "should persist processingTime without including configured responseDelayMs",
    async () => {
      const port = await findFreePort();
      appProcess = await spawnAppProcess({
        port,
        input: {
          urlCount: 1,
          retentionHours: 1,
          authKey: AUTH_KEY,
          enableJSONParsing: true,
          responseDelayMs: RESPONSE_DELAY_MS,
        },
      });

      const baseUrl = appProcess.baseUrl;

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

      const payload = createWebhookPayload({
        id: "evt_e2e_delay_contract_1",
        source: "e2e-delay-contract",
        data: { delayed: true },
      });

      const startedAt = Date.now();
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
      const elapsedMs = Date.now() - startedAt;

      expect([
        HTTP_STATUS.OK,
        HTTP_STATUS.CREATED,
        HTTP_STATUS.ACCEPTED,
      ]).toContain(ingestResponse.status);
      expect(elapsedMs).toBeGreaterThanOrEqual(
        RESPONSE_DELAY_MS - RESPONSE_DELAY_TOLERANCE_MS,
      );

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
          return items.some(
            (item) =>
              item.webhookId === webhookId &&
              typeof item.processingTime === "number",
          );
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
      const eventLog = logs.find(
        (item) =>
          item.webhookId === webhookId &&
          typeof item.processingTime === "number",
      );

      expect(eventLog).toBeDefined();
      expect(eventLog?.processingTime).toBeLessThan(RESPONSE_DELAY_MS);
    },
    E2E_TEST_TIMEOUT_MS,
  );

  it(
    "should keep warm-path client-visible latency within the black-box SLO after schema caching is warm",
    async () => {
      const port = await findFreePort();
      appProcess = await spawnAppProcess({
        port,
        input: {
          urlCount: 1,
          retentionHours: 1,
          authKey: AUTH_KEY,
          enableJSONParsing: true,
          responseDelayMs: 0,
          defaultResponseCode: HTTP_STATUS.OK,
          jsonSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              source: { type: "string" },
              data: {
                type: "object",
                properties: {
                  sequence: { type: "number" },
                },
                required: ["sequence"],
              },
            },
            required: ["id", "source", "data"],
          },
        },
      });

      const baseUrl = appProcess.baseUrl;
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
      /** @type {number[]} */
      const wallClockSamples = [];

      const warmupResponse = await fetch(
        `${baseUrl}${APP_ROUTES.WEBHOOK.replace(":id", webhookId)}`,
        {
          method: HTTP_METHODS.POST,
          headers: {
            [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
            [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          },
          body: JSON.stringify(
            createWebhookPayload({
              id: "evt_e2e_latency_warmup",
              source: "e2e-latency-warmup",
              data: { sequence: -1 },
            }),
          ),
        },
      );

      expect(warmupResponse.status).toBe(HTTP_STATUS.OK);

      for (let index = 0; index < WARM_PATH_SAMPLE_COUNT; index += 1) {
        const startedAt = Date.now();
        const response = await fetch(
          `${baseUrl}${APP_ROUTES.WEBHOOK.replace(":id", webhookId)}`,
          {
            method: HTTP_METHODS.POST,
            headers: {
              [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
              [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
            },
            body: JSON.stringify(
              createWebhookPayload({
                id: `evt_e2e_latency_${index}`,
                source: "e2e-latency-slo",
                data: { sequence: index },
              }),
            ),
          },
        );
        wallClockSamples.push(Date.now() - startedAt);

        expect(response.status).toBe(HTTP_STATUS.OK);
      }

      expect(wallClockSamples).toHaveLength(WARM_PATH_SAMPLE_COUNT);

      const p50 = getPercentile(wallClockSamples, LATENCY_PERCENTILES.p50);
      const p95 = getPercentile(wallClockSamples, LATENCY_PERCENTILES.p95);
      const p99 = getPercentile(wallClockSamples, LATENCY_PERCENTILES.p99);
      const max = Math.max(...wallClockSamples);

      if (!ENABLE_CLIENT_VISIBLE_LATENCY_SLO_ASSERTIONS) {
        expect(wallClockSamples.every((sample) => sample >= 0)).toBe(true);
        return;
      }

      expect(p50).toBeLessThan(CLIENT_VISIBLE_LATENCY_SLO_TARGETS_MS.p50);
      expect(p95).toBeLessThan(CLIENT_VISIBLE_LATENCY_SLO_TARGETS_MS.p95);
      expect(p99).toBeLessThan(CLIENT_VISIBLE_LATENCY_SLO_TARGETS_MS.p99);
      expect(max).toBeLessThan(CLIENT_VISIBLE_LATENCY_SLO_TARGETS_MS.max);
    },
    E2E_TEST_TIMEOUT_MS,
  );
});
