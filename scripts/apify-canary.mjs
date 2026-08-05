#!/usr/bin/env node
/**
 * @file scripts/apify-canary.mjs
 * @description Post-release Apify canary for warm webhook latency and resurrection.
 */

const APIFY_API_BASE_URL = "https://api.apify.com";
const DEFAULT_ACTOR_ID = "ar27111994~webhook-debugger-logger";
const DEFAULT_SAMPLE_COUNT = 12;
const DEFAULT_READY_ATTEMPTS = 60;
const READY_DELAY_MS = 2000;
const PERCENTILE_DENOMINATOR = 100;
const P50_PERCENTILE = 50;
const P95_PERCENTILE = 95;
const NO_SCRIPT_P50_BUDGET_MS = 50;
const NO_SCRIPT_P95_BUDGET_MS = 150;
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;

const token = process.env.APIFY_TOKEN;
const actorId = (process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR_ID).replace(
  "/",
  "~",
);
const sampleCount = Number(
  process.env.APIFY_CANARY_SAMPLE_COUNT || DEFAULT_SAMPLE_COUNT,
);

if (!token) {
  throw new Error("APIFY_TOKEN is required for the post-release canary.");
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number[]} samples
 * @param {number} percentile
 * @returns {number}
 */
function percentile(samples, percentile) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((percentile / PERCENTILE_DENOMINATOR) * sorted.length) - 1,
  );
  return sorted[index];
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
async function apifyRequest(path, options = {}) {
  const response = await fetch(`${APIFY_API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apify API ${response.status} for ${path}: ${body}`);
  }

  return response.json();
}

/**
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
async function waitForReady(baseUrl) {
  for (let attempt = 1; attempt <= DEFAULT_READY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status >= HTTP_OK_MIN && response.status < HTTP_OK_MAX) {
        return;
      }
    } catch {
      // Actor web server may still be starting.
    }
    await sleep(READY_DELAY_MS);
  }

  throw new Error(`Timed out waiting for canary run at ${baseUrl}`);
}

/**
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function getWebhookId(baseUrl) {
  const response = await fetch(`${baseUrl}/info`);
  if (!response.ok) {
    throw new Error(`Canary /info failed with ${response.status}`);
  }
  const info = await response.json();
  return String(info.system.activeWebhooks[0].id);
}

/**
 * @param {string} baseUrl
 * @param {string} webhookId
 * @param {string} label
 * @returns {Promise<number[]>}
 */
async function sendSamples(baseUrl, webhookId, label) {
  /** @type {number[]} */
  const samples = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}/webhook/${webhookId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: `evt_apify_canary_${label}_${index}`,
        source: "apify-canary",
        data: { sequence: index },
      }),
    });
    samples.push(performance.now() - startedAt);

    if (!response.ok) {
      throw new Error(`Canary webhook failed with ${response.status}`);
    }
  }

  return samples;
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const runResponse = await apifyRequest(
    `/v2/acts/${encodeURIComponent(actorId)}/runs`,
    {
      method: "POST",
      body: {
        urlCount: 1,
        retentionHours: 1,
        responseMode: "fast",
        enableJSONParsing: true,
        defaultResponseCode: 200,
      },
    },
  );

  let runId = runResponse.data.id;
  let baseUrl = `https://${runId}.runs.apify.net`;

  try {
    await waitForReady(baseUrl);
    let webhookId = await getWebhookId(baseUrl);
    let samples = await sendSamples(baseUrl, webhookId, "initial");

    const resurrected = await apifyRequest(
      `/v2/actor-runs/${runId}/resurrect`,
      {
        method: "POST",
      },
    );

    runId = resurrected.data?.id || runId;
    baseUrl = `https://${runId}.runs.apify.net`;
    await waitForReady(baseUrl);
    webhookId = await getWebhookId(baseUrl);
    samples = samples.concat(
      await sendSamples(baseUrl, webhookId, "resurrected"),
    );

    const p50 = percentile(samples, P50_PERCENTILE);
    const p95 = percentile(samples, P95_PERCENTILE);
    console.log(
      JSON.stringify({ actorId, runId, sampleCount: samples.length, p50, p95 }),
    );

    if (p50 >= NO_SCRIPT_P50_BUDGET_MS || p95 >= NO_SCRIPT_P95_BUDGET_MS) {
      throw new Error(
        `Canary latency budget failed: p50=${p50}ms p95=${p95}ms`,
      );
    }
  } finally {
    await apifyRequest(`/v2/actor-runs/${runId}/abort`, {
      method: "POST",
    }).catch((error) => {
      console.warn(`Failed to abort canary run ${runId}: ${error.message}`);
    });
  }
}

await main();
