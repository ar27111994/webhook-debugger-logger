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

  test("GET / should return version info", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain(`v${version}`);
  });

  test("GET / with readiness probe header", async () => {
    const res = await request(app)
      .get("/")
      .set("x-apify-container-server-readiness-probe", "true");
    expect(res.statusCode).toBe(200);
  });
});
