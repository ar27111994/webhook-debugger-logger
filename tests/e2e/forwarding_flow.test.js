import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType, sleep } from "../setup/helpers/test-utils.js";
import http from "http";

// Setup mocks - Real DB, Real Axios, Mock SSRF to allow local target
await setupCommonMocks({
  apify: true,
  logger: true,
  db: false,
  repositories: false,
  axios: false,
  ssrf: true,
});

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { ssrfMock } = await import("../setup/helpers/shared-mocks.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("express").Request} Request
 */

describe("Forwarding Flow E2E", () => {
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
  /** @type {Request[]} */
  const receivedRequests = [];

  useMockCleanup();

  beforeAll(async () => {
    // 1. Start mock target server
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

    // 2. Start App with Forwarding configured
    ({ appClient, teardownApp } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];

    const targetUrl = `http://127.0.0.1:${targetPort}/forward`;

    // Mock SSRF to allow our local target
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: true,
      href: targetUrl,
      host: `127.0.0.1:${targetPort}`,
    });

    const data = webhookManager.getWebhookData(webhookId);
    if (data) {
      data.forwardUrl = targetUrl;
      data.forwardHeaders = true;
      await webhookManager.persist();
    }
  });

  afterAll(async () => {
    await teardownApp();
    if (targetServer) targetServer.close();
  });

  test("should automatically forward ingested webhooks to targetUrl", async () => {
    // 1. Send Webhook
    await appClient
      .post(`/webhook/${webhookId}`)
      .set("X-Custom-Header", "Flow-Test")
      .send({ hello: "world" })
      .expect(200);

    // 2. Webhook ingestion is async in terms of forwarding?

    // Give it a moment to complete the outgoing request
    await sleep(500);

    // 3. Verify target received the request
    expect(receivedRequests.length).toBe(1);
    const forwarded = receivedRequests[0];

    expect(forwarded.method).toBe("POST");
    expect(forwarded.url).toBe("/forward");

    const body = JSON.parse(forwarded.body);
    expect(body).toEqual({ hello: "world" });
  });
});
