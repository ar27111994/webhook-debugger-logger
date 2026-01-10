import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { sleep } from "./helpers/test-utils.js";

/** @typedef {import('./helpers/apify-mock.js').ApifyMock} Actor */
/** @typedef {import('express').Express} Express */

// 1. Setup mocks
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

// 2. Import modules
const request = (await import("supertest")).default;
/** @type {Actor} */
const Actor = /** @type {any} */ ((await import("apify")).Actor);
const { initialize, shutdown, webhookManager } = await import("../src/main.js");

const reloadSleepMs = 150;

describe("Hot-Reloading Configuration Tests", () => {
  /** @type {Express} */
  let app;

  beforeAll(async () => {
    // Start with basic config
    jest.mocked(Actor.getInput).mockResolvedValue({
      authKey: "original-key",
      urlCount: 1,
      retentionHours: 1,
    });
    app = /** @type {Express} */ (await initialize());
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

    // 2. Emit new input
    const apifyMock = Actor;
    apifyMock.emitInput({
      authKey: "new-secret-key",
      urlCount: 1,
      retentionHours: 1,
    });
    await sleep(reloadSleepMs);

    // Verify old key fails
    const res2 = await request(app)
      .get("/info")
      .set("Authorization", "Bearer original-key");
    expect(res2.statusCode).toBe(401);

    // Verify new key works
    const res3 = await request(app)
      .get("/info")
      .set("Authorization", "Bearer new-secret-key");
    expect(res3.statusCode).toBe(200);
  });

  test("should detect input change and update components", async () => {
    // 1. Setup initial state
    const apifyMock = Actor;
    apifyMock.emitInput({
      authKey: "initial-key",
      urlCount: 3,
      retentionHours: 1,
    });
    await sleep(reloadSleepMs);

    const initialActive = webhookManager.getAllActive().length;
    expect(initialActive).toBe(3);

    // Scale up to 3
    // Scale up to 3
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 3,
      retentionHours: 1,
    });
    await sleep(reloadSleepMs);

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
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 3,
      retentionHours: 1,
      customScript:
        "event.statusCode = 201; event.responseBody = 'Transformed!';",
    });
    await sleep(reloadSleepMs);

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

    await Actor.emitInput({
      jsonSchema: "{ invalid json: }", // Malformed
      authKey: "new-super-secret",
    });
    await sleep(reloadSleepMs);

    // Verify error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SCHEMA-ERROR]"),
      expect.any(String),
    );
    consoleSpy.mockRestore();

    // Verify app is still responsive
    const res = await request(app)
      .get("/info")
      .set("Authorization", "Bearer new-super-secret");

    // Ensure we got a response (not a connection refused/crash)
    expect(res.statusCode).toBe(200);
  });
});
