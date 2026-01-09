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
} from "@jest/globals";

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

jest.unstable_mockModule("dns/promises", async () => {
  const { dnsPromisesMock } = await import("./helpers/shared-mocks.js");
  return { default: dnsPromisesMock };
});

const request = (await import("supertest")).default;
const { app, webhookManager, initialize, shutdown } =
  await import("../src/main.js");
const { Actor } = await import("apify");

describe("API E2E Tests", () => {
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

  test("GET /logs should return captured items and filters", async () => {
    // Mock dataset to return one item for this test
    const mockItem = {
      webhookId,
      method: "POST",
      body: '{"test":"data"}',
      timestamp: new Date().toISOString(),
    };
    jest.mocked(Actor.openDataset).mockResolvedValue(
      /** @type {any} */ ({
        getData: jest.fn(async () => ({ items: [mockItem] })),
      }),
    );

    const res = await request(app).get("/logs").query({ webhookId });
    expect(res.statusCode).toBe(200);
    expect(res.body.filters).toBeDefined();
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].webhookId).toBe(webhookId);
  });

  test("GET /replay should resend event", async () => {
    // Mock dataset to return the item to replay
    const mockItem = {
      id: "evt_123",
      webhookId,
      method: "POST",
      body: '{"test":"data"}',
      headers: {},
    };
    jest.mocked(Actor.openDataset).mockResolvedValue(
      /** @type {any} */ ({
        getData: jest.fn(async () => ({ items: [mockItem] })),
      }),
    );

    // Mock axios to prevent real network calls
    const axios = (await import("axios")).default;
    /** @type {any} */ (axios).mockResolvedValue({ status: 200, data: "OK" });

    const res = await request(app)
      .get(`/replay/${webhookId}/evt_123`)
      .query({ url: "http://example.com/target" });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");
  });

  test("POST /replay should also resend event", async () => {
    const mockItem = {
      id: "evt_789",
      webhookId,
      method: "POST",
      body: '{"foo":"bar"}',
      headers: {},
    };
    jest.mocked(Actor.openDataset).mockResolvedValue(
      /** @type {any} */ ({
        getData: jest.fn(async () => ({ items: [mockItem] })),
      }),
    );

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
    // Use native http module for SSE endpoints since supertest can't handle streaming
    const http = require("http");
    const port = 9999;
    const testServer = app.listen(port, () => {
      const req = http.get(`http://localhost:${port}/log-stream`, (res) => {
        // Verify SSE headers
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(res.headers["cache-control"]).toBe("no-cache");
        expect(res.headers["connection"]).toBe("keep-alive");
        // Close the request immediately after verifying headers
        req.destroy();
        testServer.close(() => done());
      });
      req.on("error", () => {
        // Expected when we abort
        testServer.close(() => done());
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
    jest.mocked(Actor.openDataset).mockResolvedValue(
      /** @type {any} */ ({
        getData: jest.fn(async () => ({ items: [] })),
      }),
    );

    const res = await request(app).get(`/replay/${webhookId}/evt_123`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Missing 'url' parameter");
  });

  test("GET /replay/:webhookId/:itemId with non-existent event should return 404", async () => {
    jest.mocked(Actor.openDataset).mockResolvedValue(
      /** @type {any} */ ({
        getData: jest.fn(async () => ({ items: [] })),
      }),
    );

    const axios = (await import("axios")).default;
    // @ts-expect-error - Mock function on imported module
    axios.mockResolvedValue({ status: 200 });

    // DNS mock is registered at module level via shared-mocks
    const { dnsPromisesMock } = await import("./helpers/shared-mocks.js");
    /** @type {any} */ (dnsPromisesMock.resolve4).mockResolvedValue([
      "93.184.216.34",
    ]);

    const res = await request(app)
      .get(`/replay/${webhookId}/evt_nonexistent`)
      .query({ url: "http://example.com" });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("Event not found");
  });
});
