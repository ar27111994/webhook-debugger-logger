import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
} from "@jest/globals";

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const { app, webhookManager, initialize, shutdown } =
  await import("../src/main.js");
const { Actor } = await import("apify");
const request = (await import("supertest")).default;
const { createDatasetMock } = await import("./helpers/shared-mocks.js");
const authKey = "TEST_KEY";
const authHeader = `Bearer ${authKey}`;

describe("Log Filtering Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeAll(async () => {
    // Enforce auth to test 401 scenarios
    jest.mocked(Actor.getInput).mockResolvedValue({ authKey });
    await initialize();
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  describe("Root Route Content Negotiation", () => {
    test("GET / should return 200 OK for readiness probe", async () => {
      const res = await request(app)
        .get("/")
        .set("X-Apify-Container-Server-Readiness-Probe", "1");
      expect(res.statusCode).toBe(200);
      expect(res.text).toBe("OK");
    });

    test("GET / should return 401 HTML for browser without auth", async () => {
      // Ensure we don't send auth headers
      const res = await request(app).get("/").set("Accept", "text/html");

      expect(res.statusCode).toBe(401);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("Access Restricted");
      expect(res.text).toContain("Strict Mode enabled");
    });

    test("GET / should return 401 JSON for non-browser without auth", async () => {
      const res = await request(app).get("/").set("Accept", "application/json");

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    test("GET / should return 200 HTML with Dashboard loop for valid auth", async () => {
      const res = await request(app)
        .get("/")
        .set("Accept", "text/html")
        .set("Authorization", authHeader);

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain("Webhook Debugger");
      expect(res.text).toContain("Enterprise Suite");
      expect(res.text).toMatch(/\d+ active endpoints/);
    });
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

    jest.spyOn(webhookManager, "isValid").mockReturnValue(true);
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock(items)));

    // Filter by Method
    let res = await request(app)
      .get("/logs")
      .query({ method: "GET" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].method).toBe("GET");

    // Filter by StatusCode
    res = await request(app)
      .get("/logs")
      .query({ statusCode: "404" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].statusCode).toBe(404);

    // Filter by ContentType
    res = await request(app)
      .get("/logs")
      .query({ contentType: "text/plain" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].headers["content-type"]).toBe("text/plain");

    // Filter by WebhookId
    res = await request(app)
      .get("/logs")
      .query({ webhookId: "wh_2" })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].webhookId).toBe("wh_2");
  });

  test("GET /logs handles pagination limits", async () => {
    const items = new Array(200).fill(0).map((_, _i) => ({
      webhookId: "wh_1",
      timestamp: new Date().toISOString(),
    }));

    const mockDataset = createDatasetMock(items);
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (mockDataset));

    const res = await request(app)
      .get("/logs")
      .query({ limit: 10 })
      .set("Authorization", authHeader);
    expect(res.body.items).toHaveLength(10);
    expect(res.body.count).toBe(10);

    // Verify getData was called with the correct limit
    expect(mockDataset.getData).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });
});
