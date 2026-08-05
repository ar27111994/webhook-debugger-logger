/**
 * @file tests/e2e/perf.release-gate.test.js
 * @description PERF_RUN release gate for webhook warm-path latency classes.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUTH_CONSTS } from "../../src/consts/auth.js";
import {
  APP_ROUTES,
  LATENCY_BUDGETS,
  RESPONSE_MODES,
} from "../../src/consts/app.js";
import {
  HTTP_HEADERS,
  HTTP_METHODS,
  HTTP_STATUS,
} from "../../src/consts/http.js";
import {
  findFreePort,
  httpRequest,
  spawnAppProcess,
} from "../setup/helpers/e2e-process-harness.js";
import { createWebhookPayload } from "../setup/helpers/fixtures/payload-fixtures.js";

const shouldRunPerfGate = process.env.PERF_RUN === "1";
const DEFAULT_SCENARIO = "no-custom-script";
const PERF_AUTH_KEY = "perf-gate-secret";
const DEFAULT_SAMPLE_COUNT = 12;
const SAMPLE_COUNT = Number(
  process.env.PERF_SAMPLE_COUNT || DEFAULT_SAMPLE_COUNT,
);
const TEST_TIMEOUT_MS = 60000;
const PERCENTILE_DENOMINATOR = 100;
const P50_PERCENTILE = 50;
const P95_PERCENTILE = 95;
const RESURRECTION_WARMUP_SEQUENCE = -2;

const JSON_SCHEMA = Object.freeze({
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
});

const STRICT_SCRIPT = `
  event.responseBody = 'OK';
  event.responseHeaders = { 'content-type': 'text/plain' };
`;

const scenarios = Object.freeze({
  "no-custom-script": Object.freeze({
    input: Object.freeze({}),
    budget: LATENCY_BUDGETS.NO_CUSTOM_SCRIPT,
    restartBeforeMeasure: false,
  }),
  "schema-only": Object.freeze({
    input: Object.freeze({ enableJSONParsing: true, jsonSchema: JSON_SCHEMA }),
    budget: LATENCY_BUDGETS.SCHEMA_ONLY,
    restartBeforeMeasure: false,
  }),
  "script-only": Object.freeze({
    input: Object.freeze({
      customScript: STRICT_SCRIPT,
      responseMode: RESPONSE_MODES.STRICT,
    }),
    budget: LATENCY_BUDGETS.STRICT_CUSTOM_SCRIPT,
    restartBeforeMeasure: false,
  }),
  "schema-plus-script": Object.freeze({
    input: Object.freeze({
      enableJSONParsing: true,
      jsonSchema: JSON_SCHEMA,
      customScript: STRICT_SCRIPT,
      responseMode: RESPONSE_MODES.STRICT,
    }),
    budget: LATENCY_BUDGETS.STRICT_CUSTOM_SCRIPT,
    restartBeforeMeasure: false,
  }),
  "restart-resurrection": Object.freeze({
    input: Object.freeze({ enableJSONParsing: true }),
    budget: LATENCY_BUDGETS.NO_CUSTOM_SCRIPT,
    restartBeforeMeasure: true,
  }),
});

/** @typedef {keyof typeof scenarios} PerfScenarioName */

/**
 * @param {string | undefined} rawScenario
 * @returns {PerfScenarioName}
 */
function resolveScenarioName(rawScenario) {
  const candidate = rawScenario || DEFAULT_SCENARIO;
  if (Object.hasOwn(scenarios, candidate)) {
    return /** @type {PerfScenarioName} */ (candidate);
  }
  return DEFAULT_SCENARIO;
}

const selectedScenario = resolveScenarioName(process.env.PERF_SCENARIO);

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

/**
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function getWebhookId(baseUrl) {
  const infoResponse = await httpRequest(
    `${baseUrl}${APP_ROUTES.INFO}`,
    HTTP_METHODS.GET,
    {
      [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${PERF_AUTH_KEY}`,
    },
  );
  expect(infoResponse.statusCode).toBe(HTTP_STATUS.OK);

  const infoBody = parseJsonBody(infoResponse.bodyText);
  return String(infoBody.system.activeWebhooks[0].id);
}

/**
 * @param {string} baseUrl
 * @param {string} webhookId
 * @param {number} sequence
 * @returns {Promise<number>}
 */
async function sendMeasuredWebhook(baseUrl, webhookId, sequence) {
  const startedAt = performance.now();
  const response = await fetch(
    `${baseUrl}${APP_ROUTES.WEBHOOK.replace(":id", webhookId)}`,
    {
      method: HTTP_METHODS.POST,
      headers: {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${PERF_AUTH_KEY}`,
        [HTTP_HEADERS.CONTENT_TYPE]: "application/json",
      },
      body: JSON.stringify(
        createWebhookPayload({
          id: `evt_perf_${selectedScenario}_${sequence}`,
          source: "perf-gate",
          data: { sequence },
        }),
      ),
    },
  );
  const elapsedMs = performance.now() - startedAt;

  expect(response.status).toBe(HTTP_STATUS.OK);
  return elapsedMs;
}

describe("E2E: PERF_RUN release latency gate", () => {
  it(
    `should keep ${selectedScenario} within configured latency budget`,
    async () => {
      if (!shouldRunPerfGate) {
        return;
      }

      const scenario = scenarios[selectedScenario];
      expect(scenario).toBeDefined();

      const storageDir = await mkdtemp(path.join(tmpdir(), "wdl-perf-"));
      /** @type {import('../setup/helpers/e2e-process-harness.js').SpawnedApp | null} */
      let appProcess = null;

      try {
        const spawnWithStorage = async () =>
          await spawnAppProcess({
            port: await findFreePort(),
            input: {
              urlCount: 1,
              retentionHours: 1,
              authKey: PERF_AUTH_KEY,
              defaultResponseCode: HTTP_STATUS.OK,
              ...scenario.input,
            },
            envOverrides: {
              APIFY_LOCAL_STORAGE_DIR: storageDir,
            },
          });

        appProcess = await spawnWithStorage();
        let baseUrl = appProcess.baseUrl;
        let webhookId = await getWebhookId(baseUrl);

        await sendMeasuredWebhook(baseUrl, webhookId, -1);

        if (scenario.restartBeforeMeasure) {
          await appProcess.stop();
          appProcess = await spawnWithStorage();
          baseUrl = appProcess.baseUrl;
          webhookId = await getWebhookId(baseUrl);
          await sendMeasuredWebhook(
            baseUrl,
            webhookId,
            RESURRECTION_WARMUP_SEQUENCE,
          );
        }

        /** @type {number[]} */
        const samples = [];
        for (let index = 0; index < SAMPLE_COUNT; index += 1) {
          samples.push(await sendMeasuredWebhook(baseUrl, webhookId, index));
        }

        const p50 = getPercentile(samples, P50_PERCENTILE);
        const p95 = getPercentile(samples, P95_PERCENTILE);

        expect(p50).toBeLessThan(scenario.budget.p50Ms);
        expect(p95).toBeLessThan(scenario.budget.p95Ms);
      } finally {
        if (appProcess) {
          await appProcess.stop();
        }
        await rm(storageDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
