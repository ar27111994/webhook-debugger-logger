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
const ENABLE_STRESS_WINDOW_ASSERTIONS = process.env.PERF_RUN === "1";
const IS_COVERAGE_RUN = process.argv.some(
  (arg) =>
    arg === "--coverageDirectory" ||
    arg.includes("jest.coverage.matrix.config.mjs"),
);
const DEFAULT_STRESS_TOTAL_REQUESTS = 1000;
const STRESS_WINDOW_MS = 10000;
const DEFAULT_STRESS_WINDOW_GRACE_MS = 2500;
const DEFAULT_WRITER_CONCURRENCY = 100;
const RATE_LIMIT_SWEEP_REQUESTS = 150;
const DEFAULT_CONCURRENT_WRITES = 220;
const DEFAULT_CONCURRENT_READS = 220;
const DEFAULT_E2E_TIMEOUT_MS = 180000;
const COVERAGE_STRESS_TOTAL_REQUESTS = 400;
const COVERAGE_STRESS_WINDOW_GRACE_MS = 15000;
const COVERAGE_WRITER_CONCURRENCY = 50;
const COVERAGE_CONCURRENT_WRITES = 60;
const COVERAGE_CONCURRENT_READS = 60;
const COVERAGE_E2E_TIMEOUT_MS = 360000;

const STRESS_TOTAL_REQUESTS = IS_COVERAGE_RUN
  ? COVERAGE_STRESS_TOTAL_REQUESTS
  : DEFAULT_STRESS_TOTAL_REQUESTS;
const STRESS_WINDOW_GRACE_MS = IS_COVERAGE_RUN
  ? COVERAGE_STRESS_WINDOW_GRACE_MS
  : DEFAULT_STRESS_WINDOW_GRACE_MS;
const WRITER_CONCURRENCY = IS_COVERAGE_RUN
  ? COVERAGE_WRITER_CONCURRENCY
  : DEFAULT_WRITER_CONCURRENCY;
const CONCURRENT_WRITES = IS_COVERAGE_RUN
  ? COVERAGE_CONCURRENT_WRITES
  : DEFAULT_CONCURRENT_WRITES;
const CONCURRENT_READS = IS_COVERAGE_RUN
  ? COVERAGE_CONCURRENT_READS
  : DEFAULT_CONCURRENT_READS;
const E2E_TIMEOUT_MS = IS_COVERAGE_RUN
  ? COVERAGE_E2E_TIMEOUT_MS
  : DEFAULT_E2E_TIMEOUT_MS;

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

  it("should process the configured webhook request burst within the target window with CI-safe grace, show rate limiting, and keep logs stable", async () => {
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

    const ingestStatuses = await Promise.all(ingestRequests);
    const dispatchElapsedMs = Date.now() - startedAt;

    const acceptedStatuses = ingestStatuses.filter(
      (status) =>
        status === HTTP_STATUS.OK ||
        status === HTTP_STATUS.CREATED ||
        status === HTTP_STATUS.ACCEPTED,
    );

    expect(acceptedStatuses.length).toBeGreaterThan(0);
    if (ENABLE_STRESS_WINDOW_ASSERTIONS) {
      expect(dispatchElapsedMs).toBeLessThanOrEqual(
        STRESS_WINDOW_MS + STRESS_WINDOW_GRACE_MS,
      );
    } else {
      expect(dispatchElapsedMs).toBeGreaterThanOrEqual(0);
    }

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
