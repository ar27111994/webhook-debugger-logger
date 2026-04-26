/**
 * @file tests/integration/logging.query.integration.test.js
 * @description Integration tests for webhook ingestion and log query/read contracts.
 */

import { APP_ROUTES } from "../../src/consts/app.js";
import {
  HTTP_HEADERS,
  HTTP_METHODS,
  HTTP_STATUS,
  MIME_TYPES,
} from "../../src/consts/http.js";
import { startIntegrationApp } from "../setup/helpers/integration-harness.js";
import { createWebhookPayload } from "../setup/helpers/fixtures/payload-fixtures.js";
import { waitForCondition } from "../setup/helpers/test-utils.js";
import { AUTH_CONSTS } from "../../src/consts/auth.js";

/**
 * @typedef {import('supertest').Agent} AppClient
 */

const AUTH_KEY = "integration-log-secret";
const LOG_SYNC_WAIT_TIMEOUT_MS = 10000;
const LOG_SYNC_WAIT_INTERVAL_MS = 100;
const LOGS_QUERY_LIMIT = 50;
const LOGGING_QUERY_TEST_TIMEOUT_MS = 15000;
const RESPONSE_DELAY_MS = 300;
const WARM_PATH_SAMPLE_COUNT = 6;
const WARM_PATH_SAMPLE_BUFFER = 3;
const PROCESSING_TIME_SANITY_MAX_MS = 1000;
const MICROSECONDS_PER_MILLISECOND = 1000;
const PROCESSING_TIME_SANITY_MAX_US =
  PROCESSING_TIME_SANITY_MAX_MS * MICROSECONDS_PER_MILLISECOND;
const TEST_RATE_LIMIT_PER_MINUTE = 1000;

/**
 * @typedef {import("../../src/typedefs.js").LogEntry & { detailUrl?: string }} LogListItem
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
  expect(Array.isArray(infoResponse.body?.system?.activeWebhooks)).toBe(true);
  expect(infoResponse.body.system.activeWebhooks.length).toBeGreaterThan(0);

  return String(infoResponse.body.system.activeWebhooks[0].id);
}

describe("Integration: Logging and query contracts", () => {
  /** @type {{ teardown: () => Promise<void>, appClient: AppClient } | null} */
  let context = null;

  afterEach(async () => {
    if (context) {
      await context.teardown();
      context = null;
    }
  });

  it(
    "should ingest webhook payloads and expose them via /logs query endpoint",
    async () => {
      context = await startIntegrationApp({
        authKey: AUTH_KEY,
        urlCount: 1,
        retentionHours: 1,
        rateLimitPerMinute: TEST_RATE_LIMIT_PER_MINUTE,
        enableJSONParsing: true,
        customScript: undefined,
        jsonSchema: undefined,
        defaultResponseBody: "ingested",
        defaultResponseCode: HTTP_STATUS.CREATED,
      });
      const activeContext = requireContext(context);

      const webhookId = await resolveActiveWebhookId(activeContext.appClient);
      const payload = createWebhookPayload({
        id: "evt_integration_query_1",
        source: "integration-suite",
      });

      const ingestResponse = await activeContext.appClient
        .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
        .send(payload);

      expect(ingestResponse.status).toBe(HTTP_STATUS.CREATED);
      expect(String(ingestResponse.text)).toContain("ingested");

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

          /** @type {LogListItem[]} */
          const items = Array.isArray(logsResponse.body?.items)
            ? logsResponse.body.items
            : [];

          return items.some((item) => item.webhookId === webhookId);
        },
        LOG_SYNC_WAIT_TIMEOUT_MS,
        LOG_SYNC_WAIT_INTERVAL_MS,
      );

      const finalLogsResponse = await activeContext.appClient
        .get(APP_ROUTES.LOGS)
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .query({ webhookId, limit: LOGS_QUERY_LIMIT });

      expect(finalLogsResponse.status).toBe(HTTP_STATUS.OK);
      expect(Array.isArray(finalLogsResponse.body.items)).toBe(true);
      expect(finalLogsResponse.body.items.length).toBeGreaterThan(0);

      /** @type {LogListItem[]} */
      const items = finalLogsResponse.body.items;
      const createdItem = items.find((item) => item.webhookId === webhookId);

      expect(createdItem).toBeDefined();
      expect(String(createdItem?.id).length).toBeGreaterThan(0);
      expect(String(createdItem?.method)).toBe(HTTP_METHODS.POST);
      expect(typeof createdItem?.processingTimeUs).toBe("number");
      expect(String(createdItem?.detailUrl).startsWith("/")).toBe(true);
      expect(String(createdItem?.detailUrl)).toContain(String(createdItem?.id));

      const detailResponse = await activeContext.appClient
        .get(`${String(createdItem?.detailUrl)}?fields=id,webhookId,method`)
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        );

      expect([HTTP_STATUS.OK, HTTP_STATUS.NOT_FOUND]).toContain(
        detailResponse.status,
      );
      if (detailResponse.status === HTTP_STATUS.OK) {
        expect(String(detailResponse.body.webhookId)).toBe(webhookId);
      }
    },
    LOGGING_QUERY_TEST_TIMEOUT_MS,
  );

  it(
    "should persist multiple warm-path processingTime samples for downstream percentile verification",
    async () => {
      context = await startIntegrationApp({
        authKey: AUTH_KEY,
        urlCount: 1,
        retentionHours: 1,
        rateLimitPerMinute: TEST_RATE_LIMIT_PER_MINUTE,
        enableJSONParsing: true,
        customScript: undefined,
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
        responseDelayMs: 0,
        defaultResponseCode: HTTP_STATUS.OK,
      });
      const activeContext = requireContext(context);

      const webhookId = await resolveActiveWebhookId(activeContext.appClient);

      const warmupPayload = createWebhookPayload({
        id: "evt_integration_latency_warmup",
        source: "integration-latency-warmup",
        data: { sequence: -1 },
      });

      const warmupResponse = await activeContext.appClient
        .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
        .send(warmupPayload);

      expect([
        HTTP_STATUS.OK,
        HTTP_STATUS.CREATED,
        HTTP_STATUS.ACCEPTED,
      ]).toContain(warmupResponse.status);

      for (let index = 0; index < WARM_PATH_SAMPLE_COUNT; index += 1) {
        const response = await activeContext.appClient
          .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
          .set(
            HTTP_HEADERS.AUTHORIZATION,
            `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          )
          .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
          .send(
            createWebhookPayload({
              id: `evt_integration_latency_${index}`,
              source: "integration-latency-slo",
              data: { sequence: index },
            }),
          );

        expect([
          HTTP_STATUS.OK,
          HTTP_STATUS.CREATED,
          HTTP_STATUS.ACCEPTED,
        ]).toContain(response.status);
      }

      await waitForCondition(
        async () => {
          const logsResponse = await activeContext.appClient
            .get(APP_ROUTES.LOGS)
            .set(
              HTTP_HEADERS.AUTHORIZATION,
              `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
            )
            .query({
              webhookId,
              limit: WARM_PATH_SAMPLE_COUNT + WARM_PATH_SAMPLE_BUFFER,
            });

          if (logsResponse.status !== HTTP_STATUS.OK) {
            return false;
          }

          /** @type {LogListItem[]} */
          const items = Array.isArray(logsResponse.body?.items)
            ? logsResponse.body.items
            : [];

          const warmPathSamples = items.filter(
            (item) =>
              item.webhookId === webhookId &&
              typeof item.processingTime === "number" &&
              typeof item.processingTimeUs === "number",
          );

          return warmPathSamples.length >= WARM_PATH_SAMPLE_COUNT;
        },
        LOG_SYNC_WAIT_TIMEOUT_MS,
        LOG_SYNC_WAIT_INTERVAL_MS,
      );

      const finalLogsResponse = await activeContext.appClient
        .get(APP_ROUTES.LOGS)
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .query({
          webhookId,
          limit: WARM_PATH_SAMPLE_COUNT + WARM_PATH_SAMPLE_BUFFER,
        });

      expect(finalLogsResponse.status).toBe(HTTP_STATUS.OK);
      /** @type {LogListItem[]} */
      const items = Array.isArray(finalLogsResponse.body?.items)
        ? finalLogsResponse.body.items
        : [];
      const warmPathSamples = items
        .filter(
          (item) =>
            item.webhookId === webhookId &&
            typeof item.processingTime === "number" &&
            typeof item.processingTimeUs === "number",
        )
        .slice(0, WARM_PATH_SAMPLE_COUNT);

      const warmPathSamplesMs = warmPathSamples.map((item) =>
        Number(item.processingTime),
      );
      const warmPathSamplesUs = warmPathSamples.map((item) =>
        Number(item.processingTimeUs),
      );

      expect(warmPathSamplesMs).toHaveLength(WARM_PATH_SAMPLE_COUNT);
      expect(warmPathSamplesUs).toHaveLength(WARM_PATH_SAMPLE_COUNT);

      expect(warmPathSamplesMs.every((sample) => sample >= 0)).toBe(true);
      expect(warmPathSamplesUs.every((sample) => sample >= 0)).toBe(true);
      expect(
        warmPathSamples.every(
          (item) =>
            Number(item.processingTimeUs) >=
            Number(item.processingTime) * MICROSECONDS_PER_MILLISECOND,
        ),
      ).toBe(true);
      expect(Math.max(...warmPathSamplesMs)).toBeLessThan(
        PROCESSING_TIME_SANITY_MAX_MS,
      );
      expect(Math.max(...warmPathSamplesUs)).toBeLessThan(
        PROCESSING_TIME_SANITY_MAX_US,
      );
    },
    LOGGING_QUERY_TEST_TIMEOUT_MS,
  );

  it(
    "should delay the response without persisting simulated delay inside processingTime",
    async () => {
      context = await startIntegrationApp({
        authKey: AUTH_KEY,
        urlCount: 1,
        retentionHours: 1,
        rateLimitPerMinute: TEST_RATE_LIMIT_PER_MINUTE,
        enableJSONParsing: true,
        customScript: undefined,
        jsonSchema: undefined,
        responseDelayMs: RESPONSE_DELAY_MS,
        defaultResponseCode: HTTP_STATUS.ACCEPTED,
      });
      const activeContext = requireContext(context);

      const webhookId = await resolveActiveWebhookId(activeContext.appClient);
      const payload = createWebhookPayload({
        id: "evt_integration_delay_1",
        source: "integration-delay-contract",
      });

      const ingestResponse = await activeContext.appClient
        .post(APP_ROUTES.WEBHOOK.replace(":id", webhookId))
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
        .send(payload);

      expect(ingestResponse.status).toBe(HTTP_STATUS.ACCEPTED);

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

          /** @type {LogListItem[]} */
          const items = Array.isArray(logsResponse.body?.items)
            ? logsResponse.body.items
            : [];

          return items.some((item) => item.webhookId === webhookId);
        },
        LOG_SYNC_WAIT_TIMEOUT_MS,
        LOG_SYNC_WAIT_INTERVAL_MS,
      );

      const finalLogsResponse = await activeContext.appClient
        .get(APP_ROUTES.LOGS)
        .set(
          HTTP_HEADERS.AUTHORIZATION,
          `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        )
        .query({ webhookId, limit: LOGS_QUERY_LIMIT });

      expect(finalLogsResponse.status).toBe(HTTP_STATUS.OK);
      /** @type {LogListItem[]} */
      const items = finalLogsResponse.body.items;
      const createdItem = items.find(
        (item) =>
          item.webhookId === webhookId &&
          typeof item.processingTime === "number" &&
          typeof item.processingTimeUs === "number",
      );

      expect(createdItem).toBeDefined();
      expect(createdItem?.processingTime).toBeLessThan(RESPONSE_DELAY_MS);
      expect(createdItem?.processingTimeUs).toBeLessThan(
        RESPONSE_DELAY_MS * MICROSECONDS_PER_MILLISECOND,
      );
    },
    LOGGING_QUERY_TEST_TIMEOUT_MS,
  );
});
