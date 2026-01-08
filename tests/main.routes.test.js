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

const { app, webhookManager, initialize, shutdown } = await import(
  "../src/main.js"
);
const { Actor } = await import("apify");
const request = (await import("supertest")).default;

describe("Log Filtering Routes", () => {
  beforeAll(async () => {
    await initialize();
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("GET /logs should filter by method, status, contentType", async () => {
    const items = [
      {
        webhookId: "wh_1",
        method: "POST",
        statusCode: 200,
        headers: { "content-type": "application/json" },
        timestamp: "2023-01-01T10:00:00Z",
      },
      {
        webhookId: "wh_1",
        method: "GET",
        statusCode: 404,
        headers: { "content-type": "text/plain" },
        timestamp: "2023-01-01T10:01:00Z",
      },
      {
        webhookId: "wh_2",
        method: "POST",
        statusCode: 200,
        headers: { "content-type": "application/json" },
        timestamp: "2023-01-01T10:02:00Z",
      },
    ];

    // @ts-ignore
    webhookManager.isValid = jest.fn().mockReturnValue(true);
    // @ts-ignore
    // @ts-ignore
    jest.mocked(Actor.openDataset).mockResolvedValue({
      // @ts-ignore
      getData: jest.fn().mockResolvedValue({ items }),
    });

    // Filter by Method
    let res = await request(app).get("/logs").query({ method: "GET" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].method).toBe("GET");

    // Filter by StatusCode
    res = await request(app).get("/logs").query({ statusCode: "404" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].statusCode).toBe(404);

    // Filter by ContentType
    res = await request(app).get("/logs").query({ contentType: "text/plain" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].headers["content-type"]).toBe("text/plain");

    // Filter by WebhookId
    res = await request(app).get("/logs").query({ webhookId: "wh_2" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].webhookId).toBe("wh_2");
  });

  test("GET /logs handles pagination limits", async () => {
    const items = new Array(200).fill(0).map((_, _i) => ({
      webhookId: "wh_1",
      timestamp: new Date().toISOString(),
    }));
    // @ts-ignore
    // @ts-ignore
    jest.mocked(Actor.openDataset).mockResolvedValue({
      // @ts-ignore
      getData: jest.fn().mockResolvedValue({ items }),
    });

    const res = await request(app).get("/logs").query({ limit: 10 });
    expect(res.body.items).toHaveLength(10);
    expect(res.body.count).toBe(10);
  });
});
