import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../../package.json");

import { jest, describe, test, expect, afterAll } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import("http").Server} Server
 * @typedef {import("../setup/helpers/shared-mocks.js").AxiosMock} AxiosMock
 * @typedef {typeof import("../setup/helpers/shared-mocks.js").dnsPromisesMock} DnsPromisesMock
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../setup/helpers/app-utils.js").App} App
 * @typedef {import("../../src/typedefs.js").WebhookEvent} WebhookEvent
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { assertType } from "../setup/helpers/test-utils.js";
import { resetDb } from "../setup/helpers/db-hooks.js";
await setupCommonMocks({ axios: true, apify: true, dns: true, ssrf: true });
const { createDatasetMock, resetNetworkMocks } =
  await import("../setup/helpers/shared-mocks.js");

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");

describe("API E2E Tests", () => {
  useMockCleanup(async () => {
    await resetNetworkMocks();
  });

  /** @type {string} */
  let webhookId;
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {App} */
  let app;

  beforeAll(async () => {
    ({ appClient, teardownApp, app } = await setupTestApp());
    // Generate a test webhook
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
  });

  afterEach(async () => {
    // Cleanup DuckDB to prevent PK violations between tests
    await resetDb();
  });

  test("GET / should return version info", async () => {
    const res = await appClient.get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain(`v${version}`);
  });

  test("GET /info should return status and webhooks", async () => {
    const res = await appClient.get("/info");
    expect(res.statusCode).toBe(200);
    expect(res.body.version).toBeDefined();
    expect(res.body.system.activeWebhooks.length).toBeGreaterThanOrEqual(1);
    expect(res.body.endpoints).toBeDefined();
  });

  test("POST /webhook/:id should capture data", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .send({ test: "data" });

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("POST /webhook/:id should capture text/plain data", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send("raw data string");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("GET /logs should return captured items and filters", async () => {
    // Mock dataset to return one item for this test
    /** @type {LogEntry} */
    const mockItem = assertType({
      id: "evt_logs_test",
      webhookId,
      method: "POST",
      body: '{"test":"data"}',
      timestamp: new Date().toISOString(),
    });
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(createDatasetMock([mockItem]));
    await logRepository.batchInsertLogs([mockItem]);

    const res = await appClient.get("/logs").query({ webhookId });
    expect(res.statusCode).toBe(200);
    expect(res.body.filters).toBeDefined();
    // Use finding logic instead of exact length check to be robust against test pollution
    const foundItem = res.body.items.find(
      /**
       * @param {LogEntry} i
       * @returns {boolean}
       */
      (i) => i.id === "evt_logs_test",
    );
    expect(foundItem).toBeDefined();
    expect(foundItem.webhookId).toBe(webhookId);
  });

  test("POST /replay should also resend event", async () => {
    /** @type {LogEntry} */
    const mockItem = assertType({
      id: "evt_789",
      webhookId,
      body: '{"foo":"bar"}',
      headers: {},
      timestamp: new Date().toISOString(),
    });
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(createDatasetMock([mockItem]));
    await logRepository.batchInsertLogs([mockItem]);

    const res = await appClient
      .post(`/replay/${webhookId}/evt_789`)
      .query({ url: "http://example.com/target" });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");
  });

  test("GET / with readiness probe header", async () => {
    const res = await appClient
      .get("/")
      .set("x-apify-container-server-readiness-probe", "true");
    expect(res.statusCode).toBe(200);
  });

  test("GET /log-stream should set SSE headers and be connectable", (done) => {
    const http = require("http");
    const port = 0;
    /** @type {Server} */
    let testServer;
    let finished = false;

    // Cleanup helper: Ensures we only call done() once, clear timeout, and properly close the server.
    // This prevents "JEST: done() called multiple times" errors and dangling handles.
    const finalize = (/** @type {Error|null} */ err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (testServer) {
        testServer.close(() => done(err || undefined));
      } else {
        done(err || undefined);
      }
    };

    const timeout = setTimeout(() => {
      finalize(new Error("SSE test timed out"));
    }, 5000);

    testServer = app.listen(port, () => {
      const addr = testServer.address();
      const allocatedPort = typeof addr === "object" ? addr?.port : port;
      const req = http.get(
        `http://localhost:${allocatedPort}/log-stream`,
        {
          headers: {
            Authorization: "Bearer test-secret",
          },
        },
        (res) => {
          try {
            expect(res.headers["content-type"]).toContain("text/event-stream");
            expect(res.headers["cache-control"]).toBe("no-cache");
            expect(res.headers["connection"]).toBe("keep-alive");
            expect(res.headers["x-accel-buffering"]).toBe("no");
            expect(res.headers["content-encoding"]).toBe("identity"); // Ensure compression is disabled

            res.on("data", (chunk) => {
              const msg = chunk.toString();
              if (msg.includes(": connected")) {
                req.destroy(); // Connection successful, test passed
                finalize(null);
              }
            });
          } catch (e) {
            req.destroy();
            finalize(/** @type {Error} */ (e));
          }
        },
      );
      req.on("error", () => {
        finalize(null); // Abort handled gracefully
      });
    });
  });

  test("POST /webhook/:id with __status should set forcedStatus", async () => {
    const forcedStatus = 201;
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .query({ __status: forcedStatus.toString() })
      .send({ test: "data" });

    // forcedStatus is validated and coerced - 201 is valid
    expect(res.statusCode).toBe(forcedStatus);
  });

  test("POST /webhook/:id with invalid __status should use default", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .query({ __status: "invalid" })
      .send({ test: "data" });

    // Invalid status should fall back to default (200)
    expect(res.statusCode).toBe(200);
  });

  test("GET /replay/:webhookId/:itemId without url should return 400", async () => {
    jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock([]));

    const res = await appClient.get(`/replay/${webhookId}/evt_123`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Missing 'url' parameter");
  });

  test("GET /replay/:webhookId/:itemId with non-existent event should return 404", async () => {
    jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock([]));

    /** @type {AxiosMock} */
    const axios = assertType((await import("axios")).default);
    axios.mockResolvedValue({ status: 200 });

    const res = await appClient
      .get(`/replay/${webhookId}/evt_nonexistent`)
      .query({ url: "http://example.com" });

    expect(res.body.error).toBe("Event not found");
  });

  // --- Replay Coverage Tests ---
  test("POST /replay should handle multiple url parameters (take first)", async () => {
    // Mock openDataset to return an item
    /** @type {LogEntry} */
    const mockItem = assertType({
      id: "replay-id-1",
      webhookId: "wh_replay",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
      timestamp: "2023-01-01T00:00:00Z",
    });

    // Mock Dataset
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(createDatasetMock([mockItem]));
    await logRepository.batchInsertLogs([mockItem]);

    // Mock Axios (global shared mock)
    /** @type {AxiosMock} */
    const axios = assertType((await import("axios")).default);
    axios.mockResolvedValue({
      status: 200,
      data: "OK",
    });

    // Mock DNS
    /** @type {DnsPromisesMock} */
    const dns = assertType((await import("dns/promises")).default);
    dns.resolve4.mockResolvedValue(["93.184.216.34"]);

    const res = await appClient
      .post("/replay/wh_replay/replay-id-1")
      .query({ url: ["http://example.com/1", "http://example.com/2"] })
      .set("Authorization", "Bearer TEST_KEY");

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");
    expect(res.body.targetUrl).toBe("http://example.com/1");
  });

  test("POST /replay should find item by timestamp if ID not found", async () => {
    // Mock item
    const timestamp = "2023-01-01T12:34:56.789Z";
    /** @type {LogEntry} */
    const mockItem = assertType({
      id: "other-id",
      webhookId: "wh_replay",
      method: "POST",
      body: "{}",
      timestamp, // Matches our ID param
    });

    // Mock Dataset
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(createDatasetMock([mockItem]));
    await logRepository.batchInsertLogs([mockItem]);

    // Mock Axios
    /** @type {AxiosMock} */
    const axios = assertType((await import("axios")).default);
    axios.mockResolvedValue({
      status: 200,
      data: "OK",
    });

    // Mock DNS
    /** @type {DnsPromisesMock} */
    const dns = assertType((await import("dns/promises")).default);
    dns.resolve4.mockResolvedValue(["93.184.216.34"]);

    const res = await appClient
      .post(`/replay/wh_replay/${timestamp}`)
      .query({ url: "http://example.com" })
      .set("Authorization", "Bearer TEST_KEY");

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");
  });

  test("POST /replay should handle DNS resolution failure in SSRF check", async () => {
    // Import the mocked module to manipulate it
    const { validateUrlForSsrf, SSRF_ERRORS } =
      await import("../../src/utils/ssrf.js");

    // Import constants for expected message
    const { ERROR_MESSAGES } = await import("../../src/consts.js");

    jest.mocked(validateUrlForSsrf).mockResolvedValue({
      safe: false,
      error: SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED,
    });

    const res = await appClient
      .post("/replay/wh_replay/replay-id-1")
      .query({ url: "http://dangerous.com" })
      .set("Authorization", "Bearer TEST_KEY");

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe(ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED);
  });

  test("GET / should return text response for non-browser authenticated client", async () => {
    const res = await appClient
      .get("/")
      .set("Accept", "text/plain")
      .set("Authorization", "Bearer TEST_KEY");

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Webhook Debugger & Logger");
    expect(res.text).toContain("Enterprise Suite");
  });
});
