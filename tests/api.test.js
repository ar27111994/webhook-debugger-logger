import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";

/** @typedef {import("http").Server} Server */
/** @typedef {import("./helpers/shared-mocks.js").AxiosMock} AxiosMock */
/** @typedef {typeof import("./helpers/shared-mocks.js").dnsPromisesMock} DnsPromisesMock */

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});
const { createDatasetMock } = await import("./helpers/shared-mocks.js");

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

jest.unstable_mockModule("dns/promises", async () => {
  const { dnsPromisesMock } = await import("./helpers/shared-mocks.js");
  return { default: dnsPromisesMock };
});

jest.unstable_mockModule("../src/utils/ssrf.js", () => {
  return {
    validateUrlForSsrf: /** @type {jest.Mock<any>} */ (
      jest.fn()
    ).mockResolvedValue({
      safe: true,
      href: "http://example.com",
      host: "example.com",
    }),
    SSRF_ERRORS: {
      INVALID_URL: "Invalid URL format",
      PROTOCOL_NOT_ALLOWED: "Only http/https URLs are allowed",
      CREDENTIALS_NOT_ALLOWED: "Credentials in URL are not allowed",
      HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname",
      INVALID_IP: "URL resolves to invalid IP address",
      INTERNAL_IP: "URL resolves to internal/reserved IP range",
      VALIDATION_FAILED: "URL validation failed",
    },
    checkIpInRanges: jest.fn(() => false),
  };
});

const request = (await import("supertest")).default;
const { app, webhookManager, initialize, shutdown } =
  await import("../src/main.js");
const { Actor } = await import("apify");

describe("API E2E Tests", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset SSRF mock to default safe response
    const { validateUrlForSsrf } = await import("../src/utils/ssrf.js");
    jest.mocked(validateUrlForSsrf).mockResolvedValue({
      safe: true,
      href: "http://example.com",
      host: "example.com",
    });
  });

  /** @type {string} */
  let webhookId;

  beforeAll(async () => {
    await initialize();
    // Generate a test webhook
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("GET / should return version info", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain(`v${version}`);
  });

  test("GET /info should return status and webhooks", async () => {
    const res = await request(app).get("/info");
    expect(res.statusCode).toBe(200);
    expect(res.body.version).toBeDefined();
    expect(res.body.system.activeWebhooks.length).toBeGreaterThanOrEqual(1);
    expect(res.body.endpoints).toBeDefined();
  });

  test("POST /webhook/:id should capture data", async () => {
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .send({ test: "data" });

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("POST /webhook/:id should capture text/plain data", async () => {
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send("raw data string");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("GET /logs should return captured items and filters", async () => {
    // Mock dataset to return one item for this test
    const mockItem = {
      webhookId,
      method: "POST",
      body: '{"test":"data"}',
      timestamp: new Date().toISOString(),
    };
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));

    const res = await request(app).get("/logs").query({ webhookId });
    expect(res.statusCode).toBe(200);
    expect(res.body.filters).toBeDefined();
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].webhookId).toBe(webhookId);
  });

  test("GET /replay should resend event (Deep Search)", async () => {
    // Mock dataset to return the item to replay ONLY on the second page
    const mockItem = {
      id: "evt_123",
      webhookId,
      method: "POST",
      body: '{"test":"data"}',
      headers: {},
    };

    const datasetMock = createDatasetMock([]); // Base mock
    datasetMock.getData = /** @type {jest.Mock<any>} */ (jest.fn())
      .mockResolvedValueOnce({ items: Array(1000).fill({ id: "noise" }) }) // Page 1: Noise
      .mockResolvedValueOnce({ items: [mockItem] }); // Page 2: Target

    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (datasetMock));

    // Mock axios to prevent real network calls
    const axios = (await import("axios")).default;
    /** @type {AxiosMock} */ (axios).mockResolvedValue({
      status: 200,
      data: "OK",
    });

    const res = await request(app)
      .get(`/replay/${webhookId}/evt_123`)
      .query({ url: "http://example.com/target" });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");

    // Verify it searched at least twice
    expect(datasetMock.getData).toHaveBeenCalledTimes(2);
    expect(datasetMock.getData).toHaveBeenNthCalledWith(1, {
      desc: true,
      limit: 1000,
      offset: 0,
    });
    expect(datasetMock.getData).toHaveBeenNthCalledWith(2, {
      desc: true,
      limit: 1000,
      offset: 1000,
    });
  });

  test("POST /replay should also resend event", async () => {
    const mockItem = {
      id: "evt_789",
      webhookId,
      method: "POST",
      body: '{"foo":"bar"}',
      headers: {},
    };
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));

    const res = await request(app)
      .post(`/replay/${webhookId}/evt_789`)
      .query({ url: "http://example.com/target" });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");
  });

  test("GET / with readiness probe header", async () => {
    const res = await request(app)
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
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .query({ __status: "201" })
      .send({ test: "data" });

    // forcedStatus is validated and coerced - 201 is valid
    expect(res.statusCode).toBe(201);
  });

  test("POST /webhook/:id with invalid __status should use default", async () => {
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .query({ __status: "invalid" })
      .send({ test: "data" });

    // Invalid status should fall back to default (200)
    expect(res.statusCode).toBe(200);
  });

  test("GET /replay/:webhookId/:itemId without url should return 400", async () => {
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock([])));

    const res = await request(app).get(`/replay/${webhookId}/evt_123`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Missing 'url' parameter");
  });

  test("GET /replay/:webhookId/:itemId with non-existent event should return 404", async () => {
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock([])));

    const axios = (await import("axios")).default;
    /** @type {AxiosMock} */ (axios).mockResolvedValue({ status: 200 });

    const res = await request(app)
      .get(`/replay/${webhookId}/evt_nonexistent`)
      .query({ url: "http://example.com" });

    expect(res.body.error).toBe("Event not found");
  });

  // --- Replay Coverage Tests ---
  test("POST /replay should handle multiple url parameters (take first)", async () => {
    // Mock openDataset to return an item
    const mockItem = {
      id: "replay-id-1",
      webhookId: "wh_replay",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
      timestamp: "2023-01-01T00:00:00Z",
    };

    // Mock Dataset
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));

    // Mock Axios (global shared mock)
    const axios = (await import("axios")).default;
    /** @type {AxiosMock} */ (axios).mockResolvedValue({
      status: 200,
      data: "OK",
    });

    // Mock DNS
    const dns = /** @type {unknown} */ ((await import("dns/promises")).default);
    /** @type {DnsPromisesMock} */ (dns).resolve4.mockResolvedValue([
      "93.184.216.34",
    ]);

    const res = await request(app)
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
    const mockItem = {
      id: "other-id",
      webhookId: "wh_replay",
      method: "POST",
      body: "{}",
      timestamp: timestamp, // Matches our ID param
    };

    // Mock Dataset
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));

    // Mock Axios
    const axios = (await import("axios")).default;
    /** @type {AxiosMock} */ (axios).mockResolvedValue({
      status: 200,
      data: "OK",
    });

    // Mock DNS
    const dns = /** @type {unknown} */ ((await import("dns/promises")).default);
    /** @type {DnsPromisesMock} */ (dns).resolve4.mockResolvedValue([
      "93.184.216.34",
    ]);

    const res = await request(app)
      .post(`/replay/wh_replay/${timestamp}`)
      .query({ url: "http://example.com" })
      .set("Authorization", "Bearer TEST_KEY");

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");
  });

  test("POST /replay should handle DNS resolution failure in SSRF check", async () => {
    // Import the mocked module to manipulate it
    const { validateUrlForSsrf, SSRF_ERRORS } =
      await import("../src/utils/ssrf.js");

    // Import constants for expected message
    const { ERROR_MESSAGES } = await import("../src/consts.js");

    jest.mocked(validateUrlForSsrf).mockResolvedValue({
      safe: false,
      error: SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED,
    });

    const res = await request(app)
      .post("/replay/wh_replay/replay-id-1")
      .query({ url: "http://dangerous.com" })
      .set("Authorization", "Bearer TEST_KEY");

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe(ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED);
  });

  test("GET / should return text response for non-browser authenticated client", async () => {
    const res = await request(app)
      .get("/")
      .set("Accept", "text/plain")
      .set("Authorization", "Bearer TEST_KEY");

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Webhook Debugger & Logger");
    expect(res.text).toContain("Enterprise Suite");
  });
});
