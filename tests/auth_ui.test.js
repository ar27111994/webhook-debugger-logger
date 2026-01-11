import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

// Mock Apify
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const request = (await import("supertest")).default;
const { app, initialize, shutdown } = await import("../src/main.js");
const { Actor } = await import("apify");

describe("Auth UI Hardening Tests", () => {
  const authKey = "secret-ui-key";

  beforeAll(async () => {
    jest.mocked(Actor.getInput).mockResolvedValue({
      authKey,
      urlCount: 1,
    });
    await initialize();
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("should allow readiness probe without auth", async () => {
    const res = await request(app)
      .get("/")
      .set("x-apify-container-server-readiness-probe", "true");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("should show 'Locked' HTML for browser unauthorized access", async () => {
    const res = await request(app).get("/").set("Accept", "text/html");

    expect(res.statusCode).toBe(401);
    expect(res.text).toContain("Access Restricted");
    expect(res.text).toContain("Strict Mode");
  });

  test("should return JSON 401 for non-browser unauthorized access", async () => {
    const res = await request(app).get("/");

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("should allow access but NOT propagate key in links when authenticated via query", async () => {
    const res = await request(app)
      .get("/")
      .query({ key: authKey })
      .set("Accept", "text/html");

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Webhook Debugger");
    // Verify NO link propagation (Security requirement)
    expect(res.text).not.toContain(`?key=${authKey}`);
    expect(res.text).toContain('href="/info"');
  });

  test("should allow access but NOT propagate key when authenticated via Bearer header", async () => {
    const res = await request(app)
      .get("/")
      .set("Authorization", `Bearer ${authKey}`)
      .set("Accept", "text/html");

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Webhook Debugger");
    expect(res.text).not.toContain(authKey);
    expect(res.text).toContain('href="/info"');
  });

  test("should NOT leak key in /info JSON response when authed via header", async () => {
    const res = await request(app)
      .get("/info")
      .set("Authorization", `Bearer ${authKey}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.endpoints.logs).not.toContain("key=");
    expect(res.body.endpoints.info).not.toContain("key=");
    expect(res.body.endpoints.webhook).not.toContain("key=");
  });

  test("should NOT leak key in /info JSON response when authed via query", async () => {
    const res = await request(app).get("/info").query({ key: authKey });

    expect(res.statusCode).toBe(200);
    expect(res.body.endpoints.logs).not.toContain("key=");
    expect(res.body.endpoints.webhook).not.toContain("key=");
    expect(res.body.endpoints.info).not.toContain("key=");
  });

  test("should reject /info access without any auth", async () => {
    const res = await request(app).get("/info");
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("should reject /info access with invalid key", async () => {
    const res = await request(app).get("/info").query({ key: "wrong-key" });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("should show 'Locked' HTML for malformed auth key in query", async () => {
    const res = await request(app)
      .get("/")
      .query({ key: "malformed-key" })
      .set("Accept", "text/html");

    expect(res.statusCode).toBe(401);
    expect(res.text).toContain("Access Restricted");
    expect(res.text).toContain("Strict Mode");
    expect(res.text).toContain("Unauthorized: Invalid API key");
  });
});
