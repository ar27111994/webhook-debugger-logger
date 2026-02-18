import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import {
  sleep,
  waitForCondition,
  assertType,
} from "../setup/helpers/test-utils.js";
import {
  HTTP_STATUS,
  HTTP_HEADERS,
  MIME_TYPES,
} from "../../src/consts/index.js";

/**
 * @typedef {import('../setup/helpers/apify-mock.js').ApifyMock} Actor
 * @typedef {import('express').Express} Express
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

// 1. Setup mocks
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";

await setupCommonMocks({ apify: true, logger: true, consts: true });

// 2. Import modules
const { setupTestApp } = await import("../setup/helpers/app-utils.js");
/** @type {Actor} */
const Actor = assertType((await import("apify")).Actor);
const { webhookManager } = await import("../../src/main.js");

describe("Hot-Reloading Configuration Tests", () => {
  /** @type {Express} */
  let _app;
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  beforeAll(async () => {
    // Start with basic config
    jest.mocked(Actor.getInput).mockResolvedValue({
      authKey: "original-key",
      urlCount: 1,
      retentionHours: 1,
    });
    jest.setTimeout(15000);
    ({ app: _app, appClient, teardownApp } = await setupTestApp({}, true));
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should update authKey in real-time", async () => {
    // Verify original key works
    const res1 = await appClient
      .get("/info")
      .set("Authorization", "Bearer original-key");
    expect(res1.statusCode).toBe(HTTP_STATUS.OK);

    // 2. Emit new input
    const apifyMock = Actor;
    apifyMock.emitInput({
      authKey: "new-secret-key",
      urlCount: 1,
      retentionHours: 1,
    });

    // Wait for the new key to be accepted
    await waitForCondition(async () => {
      const res = await appClient
        .get("/info")
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer new-secret-key");
      return res.statusCode === HTTP_STATUS.OK;
    }, 10000);

    // Verify old key fails
    const res2 = await appClient
      .get("/info")
      .set("Authorization", "Bearer original-key");
    expect(res2.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

    // Verify new key works
    const res3 = await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer new-secret-key");
    expect(res3.statusCode).toBe(HTTP_STATUS.OK);
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
    const res1 = await appClient
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .send({ data: "test" });
    expect(res1.text).toBe("OK");

    // 2. Add custom script via hot-reload
    await Actor.emitInput({
      authKey: "new-super-secret",
      urlCount: 3,
      retentionHours: 1,
      customScript: `event.statusCode = ${HTTP_STATUS.CREATED}; event.responseBody = 'Transformed!';`,
    });

    // Wait for script to take effect
    await waitForCondition(async () => {
      const res = await appClient
        .post(`/webhook/${whId}`)
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer new-super-secret")
        .send({ data: "test" });
      return (
        res.statusCode === HTTP_STATUS.CREATED && res.text === "Transformed!"
      );
    });

    // 3. Verify transformation applies immediately
    const res2 = await appClient
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .send({ data: "test" });
    expect(res2.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(res2.text).toBe("Transformed!");
  });

  test("should handle invalid JSON schema updates gracefully", async () => {
    await Actor.emitInput({
      jsonSchema: "{ invalid json: }", // Malformed
      authKey: "new-super-secret",
    });

    // Wait for error to be logged via structured logger
    await waitForCondition(() => loggerMock.error.mock.calls.length > 0);

    // Verify error was logged via structured pino logging
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorPrefix: "SCHEMA-ERROR",
      }),
      "Invalid resource",
    );

    // Verify app is still responsive
    const res = await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer new-super-secret");

    // Ensure we got a response (not a connection refused/crash)
    expect(res.statusCode).toBe(HTTP_STATUS.OK);
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
      const res = await appClient
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "text/plain")
        .send(largePayload);
      return res.statusCode === HTTP_STATUS.OK;
    });

    const res1 = await appClient
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .set("Content-Type", "text/plain")
      .send(largePayload);
    expect(res1.statusCode).toBe(HTTP_STATUS.OK);

    // 2. Set limit to 1MB (block 5MB)
    await Actor.emitInput({
      authKey: "new-super-secret",
      maxPayloadSize: 1024 * 1024 * 1,
    });

    // Wait until large payload is rejected
    await waitForCondition(async () => {
      const res = await appClient
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "text/plain")
        .send(largePayload);
      return res.statusCode === HTTP_STATUS.PAYLOAD_TOO_LARGE;
    });

    const res2 = await appClient
      .post(`/webhook/${whId}`)
      .set("Authorization", "Bearer new-super-secret")
      .set("Content-Type", "text/plain")
      .send(largePayload);

    // Should be blocked by middleware (HTTP_STATUS.PAYLOAD_TOO_LARGE) or bodyParser (HTTP_STATUS.PAYLOAD_TOO_LARGE)
    expect(res2.statusCode).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE);
  }, 30000);

  test("should disable schema validation when input is cleared", async () => {
    const ids = webhookManager.getAllActive();
    const whId = ids[0].id;

    // 1. Set a restrictive schema
    await Actor.emitInput({
      authKey: "new-super-secret",
      jsonSchema: JSON.stringify({
        type: "object",
        properties: { foo: { type: "string" } },
        required: ["foo"],
      }),
    });

    // Wait for it to apply
    await waitForCondition(async () => {
      const res = await appClient
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "application/json")
        .send({ bar: "baz" });
      return (
        res.statusCode === HTTP_STATUS.BAD_REQUEST &&
        res.body.error &&
        res.body.error.includes("required")
      );
    }, 15000);

    // 2. Clear schema (disable validation)
    await Actor.emitInput({
      authKey: "new-super-secret",
      jsonSchema: "", // Simulate cleared input
    });

    // Wait for it to apply (validation should pass)
    await waitForCondition(async () => {
      const res = await appClient
        .post(`/webhook/${whId}`)
        .set("Authorization", "Bearer new-super-secret")
        .set("Content-Type", "application/json")
        .send({ bar: "baz" });
      return res.statusCode === HTTP_STATUS.OK;
    }, 5000);

    const res = await appClient
      .post(`/webhook/${whId}`)
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer new-super-secret")
      .set(HTTP_HEADERS.CONTENT_TYPE, MIME_TYPES.JSON)
      .send({ bar: "baz" });

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
  }, 15000);

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
      const res = await appClient
        .get("/info")
        .set(HTTP_HEADERS.AUTHORIZATION, "Bearer stringified-secret");
      return res.statusCode === 200;
    });

    // 3. Verify it works
    const res = await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer stringified-secret");

    expect(res.statusCode).toBe(200);
    expect(res.body.system.authActive).toBe(true);
  });
});
