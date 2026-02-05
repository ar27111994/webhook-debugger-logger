import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@jest/globals";
import { HTTP_STATUS, OFFLOAD_MARKER_SYNC } from "../../src/consts.js";

// Setup mocks before imports
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

// Use app helper which handles initialization
const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");
import { createKeyValueStoreMock } from "../setup/helpers/shared-mocks.js";
import { logRepository } from "../../src/repositories/LogRepository.js";
import { assertType } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../setup/helpers/app-utils.js').AppClient} AppClient
 * @typedef {import('../setup/helpers/app-utils.js').TeardownApp} TeardownApp
 * @typedef {import('../setup/helpers/shared-mocks.js').KeyValueStoreMock} KeyValueStoreMock
 */

describe("GET /logs/:logId/payload", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {KeyValueStoreMock} */
  let kvStoreMock;

  beforeAll(async () => {
    // Setup App
    const setup = await setupTestApp();
    appClient = setup.appClient;
    teardownApp = setup.teardownApp;

    // Setup KV Mock
    kvStoreMock = createKeyValueStoreMock();
    // Mock Actor.openKeyValueStore to return our mock
    // We use spyOn if it's already defined/mocked, or just overwrite if it's a configurable mock
    // Since Actor is mocked via unstable_mockModule in mock-setup, it's a Jest mock object.
    jest
      .mocked(Actor.openKeyValueStore)
      .mockResolvedValue(assertType(kvStoreMock));
  });

  afterAll(async () => {
    await teardownApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return HTTP_STATUS.NOT_FOUND for non-existent log", async () => {
    jest.spyOn(logRepository, "getLogById").mockResolvedValue(null);

    const response = await appClient.get("/logs/non-existent-id/payload");
    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(response.body.error).toBe("Log entry not found");
  });

  it("should return HTTP_STATUS.NOT_FOUND if log belongs to invalid webhook", async () => {
    jest.spyOn(webhookManager, "isValid").mockReturnValue(false);
    jest.spyOn(logRepository, "getLogById").mockResolvedValue(
      assertType({
        id: "123",
        webhookId: "invalid-webhook",
        body: "some body",
        timestamp: new Date().toISOString(),
        method: "POST",
        headers: {},
        query: {},
        statusCode: HTTP_STATUS.OK,
      }),
    );

    const response = await appClient.get("/logs/123/payload");
    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(response.body.error).toBe("Log entry belongs to invalid webhook");
  });

  it("should return direct payload if not offloaded", async () => {
    jest.spyOn(webhookManager, "isValid").mockReturnValue(true);
    jest.spyOn(logRepository, "getLogById").mockResolvedValue(
      assertType({
        id: "123",
        webhookId: "valid-webhook",
        body: { foo: "bar" },
        contentType: "application/json",
        timestamp: new Date().toISOString(),
        method: "POST",
        headers: {},
        query: {},
        statusCode: HTTP_STATUS.OK,
      }),
    );

    const response = await appClient.get("/logs/123/payload");
    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body).toEqual({ foo: "bar" });
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });

  it("should proxy payload from KVS if offloaded", async () => {
    jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

    const kvsKey = "payload_key_123";
    const realPayload = { massive: "data" };

    jest.spyOn(logRepository, "getLogById").mockResolvedValue(
      assertType({
        id: "124",
        webhookId: "valid-webhook",
        body: {
          data: OFFLOAD_MARKER_SYNC,
          key: kvsKey,
          kvsUrl: "http://example.com",
        },
        contentType: "application/json",
        timestamp: new Date().toISOString(),
        method: "POST",
        headers: {},
        query: {},
        statusCode: HTTP_STATUS.OK,
      }),
    );

    kvStoreMock.getValue.mockResolvedValue(realPayload);

    const response = await appClient.get("/logs/124/payload");

    expect(Actor.openKeyValueStore).toHaveBeenCalled();
    expect(kvStoreMock.getValue).toHaveBeenCalledWith(kvsKey);
    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body).toEqual(realPayload);
  });
});
