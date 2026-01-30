import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@jest/globals";
import { OFFLOAD_MARKER_SYNC } from "../../src/utils/storage_helper.js";

// Setup mocks before imports
await import("../setup/helpers/mock-setup.js");

// Use app helper which handles initialization
const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { Actor } = await import("apify");
import { logRepository } from "../../src/repositories/LogRepository.js";

describe("GET /logs/:logId/payload", () => {
  let appClient;
  let teardownApp;
  let kvStoreMock;

  beforeAll(async () => {
    // Setup App
    const setup = await setupTestApp();
    appClient = setup.appClient;
    teardownApp = setup.teardownApp;

    // Setup KV Mock
    kvStoreMock = {
      setValue: jest.fn(),
      getPublicUrl: jest.fn().mockReturnValue("https://example.com/kvs/mylog"),
      getValue: jest.fn(),
    };
    // Mock Actor.openKeyValueStore to return our mock
    // We use spyOn if it's already defined/mocked, or just overwrite if it's a configurable mock
    // Since Actor is mocked via unstable_mockModule in mock-setup, it's a Jest mock object.
    Actor.openKeyValueStore.mockResolvedValue(kvStoreMock);
  });

  afterAll(async () => {
    await teardownApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset specific mocks if needed, but clearAllMocks handles counts
    // We need to ensure we don't break Actor mock for other tests if this was a suite, but it's isolated file.
  });

  it("should return 404 for non-existent log", async () => {
    jest.spyOn(logRepository, "getLogById").mockResolvedValue(null);

    const response = await appClient.get("/logs/non-existent-id/payload");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Log entry not found");
  });

  it("should return 404 if log belongs to invalid webhook", async () => {
    jest.spyOn(webhookManager, "isValid").mockReturnValue(false);
    jest.spyOn(logRepository, "getLogById").mockResolvedValue({
      id: "123",
      webhookId: "invalid-webhook",
      body: "some body",
    });

    const response = await appClient.get("/logs/123/payload");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Log entry belongs to invalid webhook");
  });

  it("should return direct payload if not offloaded", async () => {
    jest.spyOn(webhookManager, "isValid").mockReturnValue(true);
    jest.spyOn(logRepository, "getLogById").mockResolvedValue({
      id: "123",
      webhookId: "valid-webhook",
      body: { foo: "bar" },
      contentType: "application/json",
    });

    const response = await appClient.get("/logs/123/payload");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ foo: "bar" });
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });

  it("should proxy payload from KVS if offloaded", async () => {
    jest.spyOn(webhookManager, "isValid").mockReturnValue(true);

    const kvsKey = "payload_key_123";
    const realPayload = { massive: "data" };

    jest.spyOn(logRepository, "getLogById").mockResolvedValue({
      id: "124",
      webhookId: "valid-webhook",
      body: {
        data: OFFLOAD_MARKER_SYNC,
        key: kvsKey,
        kvsUrl: "http://example.com",
      },
      contentType: "application/json",
    });

    kvStoreMock.getValue.mockResolvedValue(realPayload);

    const response = await appClient.get("/logs/124/payload");

    expect(Actor.openKeyValueStore).toHaveBeenCalled();
    expect(kvStoreMock.getValue).toHaveBeenCalledWith(kvsKey);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(realPayload);
  });
});
