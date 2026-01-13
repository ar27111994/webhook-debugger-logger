import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { sleep, waitForCondition } from "./helpers/test-utils.js";

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

    // Wait for the new key to be accepted
    await waitForCondition(async () => {
      const res = await request(app)
        .get("/info")
        .set("Authorization", "Bearer new-secret-key");
      return res.statusCode === 200;
    });

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
      urlCount: 1,
      retentionHours: 1,
    });

    // Wait for initial state
    await waitForCondition(() => webhookManager.getAllActive().length === 1);

    const initialActive = webhookManager.getAllActive().length;
    expect(initialActive).toBe(1);

    // Scale up to 3
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 3,
      retentionHours: 1,
    });

    // Wait for scale up
    await waitForCondition(() => webhookManager.getAllActive().length === 3);

    const newActive = webhookManager.getAllActive().length;
    expect(newActive).toBe(3);

    // Scale down to 0
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 0,
      retentionHours: 1,
    });

    // Wait briefly to ensure no change happens (since it's not supported)
    await sleep(200);

    const zeroActive = webhookManager.getAllActive().length;
    // Scale down is not currently implemented/supported, so it should remain 3
    expect(zeroActive).toBe(3);
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

    // Wait for script to take effect
    await waitForCondition(async () => {
      const res = await request(app)
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .send({ data: "test" });
      return res.statusCode === 201 && res.text === "Transformed!";
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

    await Actor.emitInput({
      jsonSchema: "{ invalid json: }", // Malformed
      authKey: "new-super-secret",
    });
    // Wait for error to be logged
    await waitForCondition(() => consoleSpy.mock.calls.length > 0);

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

  test("should update maxPayloadSize in real-time", async () => {
    const ids = webhookManager.getAllActive();
    const whId = ids[0].id;
    const largePayload = "x".repeat(1024 * 1024 * 5); // 5MB

    // 1. Set limit to 20MB (explicitly allow 5MB to ensure deterministic start)
    await Actor.emitInput({
      authKey: "new-super-secret",
      maxPayloadSize: 1024 * 1024 * 20,
    });

    // Wait until large payload is accepted
    await waitForCondition(async () => {
      const res = await request(app)
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "text/plain")
        .send(largePayload);
      return res.statusCode === 200;
    });

    const res1 = await request(app)
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .set("Content-Type", "text/plain")
      .send(largePayload);
    expect(res1.statusCode).toBe(200);

    // 2. Set limit to 1MB (block 5MB)
    await Actor.emitInput({
      authKey: "new-super-secret",
      maxPayloadSize: 1024 * 1024 * 1,
    });

    // Wait until large payload is rejected
    await waitForCondition(async () => {
      const res = await request(app)
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "text/plain")
        .send(largePayload);
      return res.statusCode === 413;
    });

    const res2 = await request(app)
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .set("Content-Type", "text/plain")
      .send(largePayload);

    // Should be blocked by middleware (413) or bodyParser (413)
    expect(res2.statusCode).toBe(413);
  });

  test("should disable schema validation when input is cleared", async () => {
    const ids = webhookManager.getAllActive();
    const whId = ids[0].id;

    // 1. Set a restrictive schema
    await Actor.emitInput({
      authKey: "new-super-secret",
      jsonSchema: JSON.stringify({
        type: "object",
        required: ["foo"],
      }),
    });

    // Wait for it to apply
    await waitForCondition(async () => {
      const res = await request(app)
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "application/json")
        .send({ bar: "baz" });
      return (
        res.statusCode === 400 &&
        res.body.error === "JSON Schema Validation Failed"
      );
    });

    // 2. Clear schema (disable validation)
    await Actor.emitInput({
      authKey: "new-super-secret",
      jsonSchema: "", // Simulate cleared input
    });

    // Wait for it to apply (validation should pass)
    await waitForCondition(async () => {
      const res = await request(app)
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "application/json")
        .send({ bar: "baz" });
      return res.statusCode === 200;
    });

    const res = await request(app)
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .set("Content-Type", "application/json")
      .send({ bar: "baz" });

    expect(res.statusCode).toBe(200);
  });

  test("should handle stringified input from KV store", async () => {
    // 1. Emit stringified input (simulating raw KV update)
    const stringifiedInput = JSON.stringify({
      authKey: "stringified-secret",
      urlCount: 1,
      retentionHours: 1,
    });

    await Actor.emitInput(stringifiedInput);

    // 2. Wait for it to apply
    await waitForCondition(async () => {
      const res = await request(app)
        .get("/info")
        .set("Authorization", "Bearer stringified-secret");
      return res.statusCode === 200;
    });

    // 3. Verify it works
    const res = await request(app)
      .get("/info")
      .set("Authorization", "Bearer stringified-secret");

    expect(res.statusCode).toBe(200);
    expect(res.body.system.authActive).toBe(true);
  });
});
