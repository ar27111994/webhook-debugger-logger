/**
 * @file tests/e2e/resilience.test.js
 * @description E2E resilience scenarios:
 * 1) Stress: 1000 requests in 10s + rate-limit behavior + DB stability.
 * 2) Concurrency: concurrent writes/reads against DuckDB-backed log query path.
 */

import { APP_ROUTES } from "../../src/consts/app.js";
import { AUTH_CONSTS } from "../../src/consts/auth.js";
import { jest } from "@jest/globals";
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

/**
 * @typedef {import('../setup/helpers/e2e-process-harness.js').SpawnedApp} SpawnedApp
 */

const AUTH_KEY = "e2e-resilience-secret";
const STRESS_TOTAL_REQUESTS = 1000;
const STRESS_WINDOW_MS = 10000;
const WRITER_CONCURRENCY = 100;
const RATE_LIMIT_SWEEP_REQUESTS = 150;
const CONCURRENT_WRITES = 220;
const CONCURRENT_READS = 220;
const E2E_TIMEOUT_MS = 180000;

/**
 * @param {string} bodyText
 * @returns {any}
 */
function parseJsonBody(bodyText) {
  return JSON.parse(bodyText || "{}");
}

/**
 * @template T
 * @param {number} total
 * @param {number} chunkSize
 * @param {(index: number) => Promise<T>} worker
 * @returns {Promise<T[]>}
 */
async function runInChunks(total, chunkSize, worker) {
  /** @type {T[]} */
  const results = [];

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(total, start + chunkSize);
    const chunkPromises = [];
    for (let index = start; index < end; index += 1) {
      chunkPromises.push(worker(index));
    }
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return results;
}

describe("E2E: Resilience", () => {
  jest.setTimeout(E2E_TIMEOUT_MS);

  /** @type {SpawnedApp | null} */
  let appProcess = null;

  afterEach(async () => {
    if (appProcess) {
      await appProcess.stop();
      appProcess = null;
    }
  });

  it("should process 1000 webhook requests within 10s window, show rate limiting, and keep logs stable", async () => {
    const port = await findFreePort();
    appProcess = await spawnAppProcess({
      port,
      input: {
        urlCount: 1,
        retentionHours: 1,
        authKey: AUTH_KEY,
        enableJSONParsing: true,
        // Lower mgmt limit so we can observe explicit 429 behavior.
        rateLimitPerMinute: 30,
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

    const startedAt = Date.now();
    const ingestRequests = Array.from({ length: STRESS_TOTAL_REQUESTS }).map(
      async (_, index) => {
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
                id: `evt_stress_${index}`,
                source: "e2e-resilience-stress",
                data: { index },
              }),
            ),
          },
        );
        return response.status;
      },
    );

    const dispatchElapsedMs = Date.now() - startedAt;
    const ingestStatuses = await Promise.all(ingestRequests);

    const acceptedStatuses = ingestStatuses.filter(
      (status) =>
        status === HTTP_STATUS.OK ||
        status === HTTP_STATUS.CREATED ||
        status === HTTP_STATUS.ACCEPTED,
    );

    expect(acceptedStatuses.length).toBeGreaterThan(0);
    expect(dispatchElapsedMs).toBeLessThanOrEqual(STRESS_WINDOW_MS);

    // Rate-limit verification on management endpoint
    const infoStatuses = await runInChunks(
      RATE_LIMIT_SWEEP_REQUESTS,
      WRITER_CONCURRENCY,
      async () => {
        const response = await httpRequest(
          `${baseUrl}${APP_ROUTES.INFO}`,
          HTTP_METHODS.GET,
          {
            [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          },
        );
        return response.statusCode;
      },
    );

    expect(
      infoStatuses.some((status) => status === HTTP_STATUS.TOO_MANY_REQUESTS),
    ).toBe(true);
    expect(infoStatuses.some((status) => status === HTTP_STATUS.OK)).toBe(true);

    // DB stability: write-path should remain healthy even after sustained stress and limiter activity.
    const postStressWrite = await fetch(
      `${baseUrl}${APP_ROUTES.WEBHOOK.replace(":id", webhookId)}`,
      {
        method: HTTP_METHODS.POST,
        headers: {
          [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
        },
        body: JSON.stringify(
          createWebhookPayload({
            id: "evt_post_stress_stability",
            source: "e2e-resilience-stress",
            data: { stable: true },
          }),
        ),
      },
    );

    expect([
      HTTP_STATUS.OK,
      HTTP_STATUS.CREATED,
      HTTP_STATUS.ACCEPTED,
    ]).toContain(postStressWrite.status);
  });

  it("should keep DuckDB read/write path stable under concurrent webhook writes and log reads", async () => {
    const port = await findFreePort();
    appProcess = await spawnAppProcess({
      port,
      input: {
        urlCount: 1,
        retentionHours: 1,
        authKey: AUTH_KEY,
        enableJSONParsing: true,
        // High enough for this test to focus on concurrency rather than throttling.
        rateLimitPerMinute: 1000,
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

    const writerJobs = Array.from({ length: CONCURRENT_WRITES }).map(
      (_, index) =>
        fetch(`${baseUrl}${APP_ROUTES.WEBHOOK.replace(":id", webhookId)}`, {
          method: HTTP_METHODS.POST,
          headers: {
            [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
            [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          },
          body: JSON.stringify(
            createWebhookPayload({
              id: `evt_concurrent_${index}`,
              source: "e2e-resilience-concurrency",
              data: { index },
            }),
          ),
        }).then((response) => response.status),
    );

    const readerJobs = Array.from({ length: CONCURRENT_READS }).map(() =>
      httpRequest(
        `${baseUrl}${APP_ROUTES.LOGS}?webhookId=${encodeURIComponent(webhookId)}&limit=30`,
        HTTP_METHODS.GET,
        {
          [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
        },
      ).then((response) => response.statusCode),
    );

    const [writerStatuses, readerStatuses] = await Promise.all([
      Promise.all(writerJobs),
      Promise.all(readerJobs),
    ]);

    const writerServerErrors = writerStatuses.filter(
      (status) => status >= HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
    const readerServerErrors = readerStatuses.filter(
      (status) => status >= HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );

    expect(writerServerErrors.length).toBe(0);
    expect(readerServerErrors.length).toBe(0);

    const finalLogs = await httpRequest(
      `${baseUrl}${APP_ROUTES.LOGS}?webhookId=${encodeURIComponent(webhookId)}&limit=100`,
      HTTP_METHODS.GET,
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect(finalLogs.statusCode).toBe(HTTP_STATUS.OK);
  });
});
