import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType, sleep } from "../setup/helpers/test-utils.js";
import http from "http";

// Setup mocks - Use REAL components for E2E but MOCK SSRF to allow local target
await setupCommonMocks({
  apify: true,
  logger: true,
  db: false,
  repositories: false,
  axios: false, // We want real outgoing requests
  ssrf: true, // Mocked to allow local target
});

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { ssrfMock } = await import("../setup/helpers/shared-mocks.js");
import { HTTP_HEADERS } from "../../src/consts/index.js";

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("express").Request} Request
 */

describe("Replay Flow E2E", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {string} */
  let webhookId;
  /** @type {http.Server} */
  let targetServer;
  /** @type {number} */
  let targetPort;

  // Track received requests at the target
  /** @type {Request[]} */
  const receivedRequests = [];

  useMockCleanup();

  beforeAll(async () => {
    // 1. Start a mock target server
    targetServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedRequests.push(
          assertType({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body,
          }),
        );
        res.writeHead(200);
        res.end("OK");
      });
    });

    await new Promise(
      /**
       * @param {(value?: unknown) => void} resolve
       */
      (resolve) => {
        targetServer.listen(0, "127.0.0.1", () => {
          const addr = targetServer.address();
          targetPort = typeof addr === "string" ? 0 : (addr?.port ?? 0);
          resolve();
        });
      },
    );

    // 2. Start App
    ({ appClient, teardownApp } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];

    const targetUrl = `http://127.0.0.1:${targetPort}/callback`;
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: true,
      href: targetUrl,
      host: `127.0.0.1:${targetPort}`,
    });
  });

  afterAll(async () => {
    await teardownApp();
    if (targetServer) targetServer.close();
  });

  test("should ingest a webhook and successfully replay it to a target", async () => {
    // 1. Ingest Webhook
    await appClient
      .post(`/webhook/${webhookId}`)
      .send({ foo: "bar" })
      .expect(200);

    // 2. Wait for Sync to DB
    // SYNC_MIN_TIME_MS is 500ms by default
    await sleep(1000);

    // 3. Find the log entry
    const logsRes = await appClient
      .get(`/logs?webhookId=${webhookId}&limit=1`)
      .expect(200);

    expect(logsRes.body.items.length).toBe(1);
    const logId = logsRes.body.items[0].id;

    // 4. Trigger Replay
    const targetUrl = `http://127.0.0.1:${targetPort}/callback`;
    await appClient
      .post(
        `/replay/${webhookId}/${logId}?url=${encodeURIComponent(targetUrl)}`,
      )
      .expect(200);

    // 5. Verify Target Received the Replayed request
    // Replay handler awaits the request.
    expect(receivedRequests.length).toBe(1);
    const replayed = receivedRequests[0];

    expect(replayed.method).toBe("POST");
    expect(replayed.url).toBe("/callback");
    expect(replayed.headers[HTTP_HEADERS.APIFY_REPLAY.toLowerCase()]).toBe(
      "true",
    );

    const body = JSON.parse(replayed.body);
    expect(body).toEqual({ foo: "bar" });
  });
});
