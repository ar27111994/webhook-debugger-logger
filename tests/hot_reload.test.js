import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

// 1. Setup mocks
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

// 2. Import modules
const request = (await import("supertest")).default;
const { Actor } = await import("apify");
const { initialize, shutdown, webhookManager } = await import("../src/main.js");

describe("Hot-Reloading Configuration Tests", () => {
  let app;

  beforeAll(async () => {
    // Start with basic config
    jest.mocked(Actor.getInput).mockResolvedValue({
      authKey: "original-key",
      urlCount: 1,
      retentionHours: 1,
    });
    app = await initialize();
  });

  afterAll(async () => {
    await shutdown("TEST_CLEANUP");
  });

  test("should update authKey in real-time", async () => {
    // Verify original key works
    const res1 = await request(app)
      .get("/info")
      .set("Authorization", "Bearer original-key");
    expect(res1.statusCode).toBe(200);

    // Update to new key
    // @ts-ignore
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 1,
      retentionHours: 1,
    });

    // Verify old key fails
    const res2 = await request(app)
      .get("/info")
      .set("Authorization", "Bearer original-key");
    expect(res2.statusCode).toBe(401);

    // Verify new key works
    const res3 = await request(app)
      .get("/info")
      .set("Authorization", "Bearer new-super-secret");
    expect(res3.statusCode).toBe(200);
  });

  test("should scale urlCount in real-time", async () => {
    const initialActive = webhookManager.getAllActive().length;
    expect(initialActive).toBe(1);

    // Scale up to 3
    // @ts-ignore
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 3,
      retentionHours: 1,
    });

    const newActive = webhookManager.getAllActive().length;
    expect(newActive).toBe(3);
  });

  test("should update customScript in real-time", async () => {
    const ids = webhookManager.getAllActive();
    const whId = ids[0].id;

    // 1. Test original behavior (no script)
    const res1 = await request(app)
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .send({ data: "test" });
    expect(res1.text).toBe("OK");

    // 2. Add custom script via hot-reload
    // @ts-ignore
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 3,
      retentionHours: 1,
      customScript:
        "event.statusCode = 201; event.responseBody = 'Transformed!';",
    });

    // 3. Verify transformation applies immediately
    const res2 = await request(app)
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .send({ data: "test" });
    expect(res2.statusCode).toBe(201);
    expect(res2.text).toBe("Transformed!");
  });

  test("should handle invalid JSON schema updates gracefully", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // @ts-ignore
    await Actor.emitInput({
      jsonSchema: "{ invalid json: }", // Malformed
    });

    // Verify error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SCHEMA-ERROR]"),
      expect.any(String)
    );
    consoleSpy.mockRestore();

    // Verify app is still responsive
    const res = await request(app)
      .get("/info")
      .set("Authorization", "Bearer last-key");

    // Ensure we got a response (not a connection refused/crash)
    expect(res.statusCode).toBeDefined();
  });
});
