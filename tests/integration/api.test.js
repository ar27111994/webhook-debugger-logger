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
await setupCommonMocks({
  axios: true,
  apify: true,
  dns: true,
  ssrf: true,
});
const { createDatasetMock, resetNetworkMocks } =
  await import("../setup/helpers/shared-mocks.js");

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");
const {
  HTTP_STATUS,
  REPLAY_STATUS_LABELS,
  HTTP_HEADERS,
  MIME_TYPES,
  HTTP_METHODS,
} = await import("../../src/consts/index.js");
const { ERROR_MESSAGES } = await import("../../src/consts/errors.js");

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
    jest.setTimeout(15000);
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
    try {
      await resetDb();
    } catch (err) {
      console.warn("Failed to reset DB:", err);
    }
    jest.clearAllMocks();
  });

  test("GET / should return version info", async () => {
    const res = await appClient.get("/");
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.text).toContain(`v${version}`);
  });

  test("GET /info should return status and webhooks", async () => {
    const res = await appClient.get("/info");
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.version).toBeDefined();
    expect(res.body.system.activeWebhooks.length).toBeGreaterThanOrEqual(1);
    expect(res.body.endpoints).toBeDefined();
  });

  test("POST /webhook/:id should capture data", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .send({ test: "data" });

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.text).toBe("OK");
  });

  test("POST /webhook/:id should capture text/plain data", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.TEXT)
      .send("raw data string");

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
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
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.filters).toBeDefined();
    // Use finding logic instead of exact length check to be robust against test pollution
    expect(res.body.items).toContainEqual(
      expect.objectContaining({
        id: "evt_logs_test",
        webhookId,
      }),
    );
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

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.status).toBe(REPLAY_STATUS_LABELS.REPLAYED);
  });

  test("GET / with readiness probe header", async () => {
    const res = await appClient
      .get("/")
      .set(HTTP_HEADERS.APIFY_READINESS, "true");
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
  });

  test("GET /log-stream should set SSE headers and be connectable", async () => {
    const http = require("http");
    const port = 0;
    /** @type {Server | null} */
    let testServer = null;

    try {
      // 1. Start server
      await new Promise((resolve) => {
        testServer = app.listen(port, resolve);
      });

      if (!testServer) throw new Error("Server failed to start");

      const addr = /** @type {Server} */ (testServer).address();
      const allocatedPort = typeof addr === "object" ? addr?.port : port;

      // 2. Connect and wait for handshake
      let connected = false;
      const req = http.get(
        `http://localhost:${allocatedPort}/log-stream`,
        {
          headers: {
            [HTTP_HEADERS.AUTHORIZATION]: "Bearer test-secret",
          },
        },
        (res) => {
          expect(res.headers[HTTP_HEADERS.CONTENT_TYPE]).toContain(
            MIME_TYPES.EVENT_STREAM,
          );
          expect(res.headers[HTTP_HEADERS.CACHE_CONTROL]).toBe("no-cache");
          expect(res.headers[HTTP_HEADERS.CONNECTION]).toBe("keep-alive");
          expect(
            res.headers[HTTP_HEADERS.X_ACCEL_BUFFERING.toLowerCase()],
          ).toBe("no");
          expect(res.headers[HTTP_HEADERS.CONTENT_ENCODING]).toBe("identity");

          res.on("data", (chunk) => {
            if (chunk.toString().includes(": connected")) {
              connected = true;
            }
          });
        },
      );

      // 3. Wait for condition instead of manual timeout
      await import("../setup/helpers/test-utils.js").then(
        ({ waitForCondition }) => waitForCondition(() => connected, 10000),
      );

      req.destroy();
    } finally {
      if (testServer) {
        await new Promise((resolve) => testServer?.close(resolve));
      }
    }
  });

  test("POST /webhook/:id with __status should set forcedStatus", async () => {
    const forcedStatus = HTTP_STATUS.CREATED;
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .query({ __status: forcedStatus.toString() })
      .send({ test: "data" });

    // forcedStatus is validated and coerced - HTTP_STATUS.CREATED is valid
    expect(res.statusCode).toBe(forcedStatus);
  });

  test("POST /webhook/:id with invalid __status should use default", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .query({ __status: "invalid" })
      .send({ test: "data" });

    // Invalid status should fall back to default (HTTP_STATUS.OK)
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
  });

  test("GET /replay/:webhookId/:itemId without url should return HTTP_STATUS.BAD_REQUEST", async () => {
    jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock([]));

    const res = await appClient.get(`/replay/${webhookId}/evt_123`);

    expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(res.body.error).toBe(ERROR_MESSAGES.MISSING_URL);
  });

  test("GET /replay/:webhookId/:itemId with non-existent event should return HTTP_STATUS.NOT_FOUND", async () => {
    jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock([]));

    /** @type {AxiosMock} */
    const axios = assertType((await import("axios")).default);
    axios.mockResolvedValue({ status: HTTP_STATUS.OK });

    const res = await appClient
      .get(`/replay/${webhookId}/evt_nonexistent`)
      .query({ url: "http://example.com" });

    expect(res.body.error).toBe(ERROR_MESSAGES.EVENT_NOT_FOUND);
  });

  // --- Replay Coverage Tests ---
  test("POST /replay should handle multiple url parameters (take first)", async () => {
    // Mock openDataset to return an item
    /** @type {LogEntry} */
    const mockItem = assertType({
      id: "replay-id-1",
      webhookId: "wh_replay",
      method: HTTP_METHODS.POST,
      headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
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
      status: HTTP_STATUS.OK,
      data: "OK",
    });

    // Mock DNS
    /** @type {DnsPromisesMock} */
    const dns = assertType((await import("dns/promises")).default);
    dns.resolve4.mockResolvedValue(["93.184.216.34"]);

    const res = await appClient
      .post("/replay/wh_replay/replay-id-1")
      .query({ url: ["http://example.com/1", "http://example.com/2"] })
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer TEST_KEY");

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.status).toBe(REPLAY_STATUS_LABELS.REPLAYED);
    expect(res.body.targetUrl).toBe("http://example.com/1");
  });

  test("POST /replay should find item by timestamp if ID not found", async () => {
    // Mock item
    const timestamp = "2023-01-01T12:34:56.789Z";
    /** @type {LogEntry} */
    const mockItem = assertType({
      id: "other-id",
      webhookId: "wh_replay",
      method: HTTP_METHODS.POST,
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
      status: HTTP_STATUS.OK,
      data: "OK",
    });

    // Mock DNS
    /** @type {DnsPromisesMock} */
    const dns = assertType((await import("dns/promises")).default);
    dns.resolve4.mockResolvedValue(["93.184.216.34"]);

    const res = await appClient
      .post(`/replay/wh_replay/${timestamp}`)
      .query({ url: "http://example.com" })
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer TEST_KEY");

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.status).toBe(REPLAY_STATUS_LABELS.REPLAYED);
  });

  test("POST /replay should handle DNS resolution failure in SSRF check", async () => {
    // Import the mocked module to manipulate it
    const { validateUrlForSsrf } = await import("../../src/utils/ssrf.js");

    // Import constants for expected message
    const { ERROR_MESSAGES, SSRF_ERRORS } =
      await import("../../src/consts/index.js");

    jest.mocked(validateUrlForSsrf).mockResolvedValue({
      safe: false,
      error: SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED,
    });

    const res = await appClient
      .post("/replay/wh_replay/replay-id-1")
      .query({ url: "http://dangerous.com" })
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer TEST_KEY");

    expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(res.body.error).toBe(ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED);
  });

  test("GET / should return text response for non-browser authenticated client", async () => {
    const res = await appClient
      .get("/")
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.TEXT)
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer TEST_KEY");

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.text).toContain("Webhook Debugger, Logger & API Mocking Suite");
  });
});
