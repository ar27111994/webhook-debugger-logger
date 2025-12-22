import { jest } from "@jest/globals";

jest.unstable_mockModule("apify", () => ({
  Actor: {
    init: jest.fn(),
    getInput: jest.fn().mockResolvedValue({}),
    openKeyValueStore: jest.fn().mockResolvedValue({
      getValue: jest.fn().mockResolvedValue(null),
      setValue: jest.fn(),
    }),
    openDataset: jest.fn().mockResolvedValue({
      getData: jest.fn().mockResolvedValue({ items: [] }),
      pushData: jest.fn().mockResolvedValue({}),
    }),
    pushData: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    exit: jest.fn(),
  },
}));

jest.unstable_mockModule("axios", () => ({
  default: jest.fn().mockResolvedValue({ status: 200, data: "OK" }),
}));

const request = (await import("supertest")).default;
const { app, webhookManager } = await import("../src/main.js");
const { Actor } = await import("apify");

describe("API E2E Tests", () => {
  let webhookId;

  beforeAll(async () => {
    // Generate a test webhook
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  test("GET /info should return status and webhooks", async () => {
    const res = await request(app).get("/info");
    expect(res.statusCode).toBe(200);
    expect(res.body.version).toBeDefined();
    expect(res.body.activeWebhooks.length).toBeGreaterThanOrEqual(1);
  });

  test("POST /webhook/:id should capture data", async () => {
    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .send({ test: "data" });

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("GET /logs should return captured items", async () => {
    // Mock dataset to return one item for this test
    const mockItem = {
      webhookId,
      method: "POST",
      body: '{"test":"data"}',
      timestamp: new Date().toISOString(),
    };
    Actor.openDataset.mockReturnValue({
      getData: jest.fn().mockResolvedValue({ items: [mockItem] }),
    });

    const res = await request(app).get("/logs").query({ webhookId });
    expect(res.statusCode).toBe(200);
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
    Actor.openDataset.mockReturnValue({
      getData: jest.fn().mockResolvedValue({ items: [mockItem] }),
    });

    // Mock axios to prevent real network calls
    const axios = (await import("axios")).default;
    axios.mockResolvedValue({ status: 200, data: "OK" });

    const res = await request(app)
      .get(`/replay/${webhookId}/evt_123`)
      .query({ url: "http://example.com/target" });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("Replayed");
  });
});
