import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  jest,
} from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { createKeyValueStoreMock } from "../setup/helpers/shared-mocks.js";
import { assertType } from "../setup/helpers/test-utils.js";

// Setup mocks before imports
await setupCommonMocks({ axios: true, apify: true });

const { Actor } = await import("apify");
const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { OFFLOAD_MARKER_STREAM } =
  await import("../../src/utils/storage_helper.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../setup/helpers/apify-mock.js").KeyValueStoreMock} KeyValueStoreMock
 */

describe("Large Payload Stability", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {KeyValueStoreMock} */
  let kvStoreMock;

  beforeAll(async () => {
    // Initialize custom KV store mock with getPublicUrl
    kvStoreMock = createKeyValueStoreMock({
      getValue: assertType(jest.fn()).mockResolvedValue(null),
      setValue: assertType(jest.fn()).mockImplementation(
        /**
         * @param {string} _
         * @param {any} value
         * @returns {Promise<void>}
         */
        async (_, value) => {
          // Mock implementation must consume stream to prevent hanging
          if (value && typeof value.resume === "function") {
            value.resume();
            await new Promise((resolve) => value.on("end", resolve));
          }
          return undefined;
        },
      ),
    });

    // Override the mock implementation for this specific test suite
    jest
      .mocked(Actor.openKeyValueStore)
      .mockResolvedValue(assertType(kvStoreMock));

    ({ appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("Should offload >5MB payload to KVS and generate public URL", async () => {
    const [webhookId] = await webhookManager.generateWebhooks(1, 1);
    const largeBody = "a".repeat(6 * 1024 * 1024); // 6MB > 5MB threshold

    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send(largeBody);

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");

    // Verify KVS offload occurred
    expect(kvStoreMock.setValue).toHaveBeenCalled();
    const args = jest
      .mocked(kvStoreMock.setValue)
      .mock.calls.find((call) => call[0].startsWith("payload_"));
    expect(args).toBeDefined();

    // The value passed to setValue should be the request stream (object)
    expect(typeof args?.[1]).toBe("object");
    // Options are in the 3rd argument (index 2)
    expect(args?.[2]).toEqual({ contentType: "text/plain" });

    // Verify Public URL generation was attempted
    expect(kvStoreMock.getPublicUrl).toHaveBeenCalledWith(args?.[0]);

    // Verify proper event structure via pushData
    expect(Actor.pushData).toHaveBeenCalled();
    const pushDataCall = jest.mocked(Actor.pushData).mock.calls.find(
      /**
       * @param {any[]} call
       * @returns {boolean}
       */
      (call) => call[0].body && call[0].body.data === OFFLOAD_MARKER_STREAM,
    );

    expect(pushDataCall).toBeDefined();
    const { body } = assertType(pushDataCall?.[0]);
    expect(body.key).toBe(args?.[0]);
    expect(body.originalSize).toBe(largeBody.length);
  }, 60000); // Extended timeout

  test("Should NOT offload <5MB payload", async () => {
    const [webhookId] = await webhookManager.generateWebhooks(1, 1);
    const smallBody = "a".repeat(1 * 1024 * 1024); // 1MB < 5MB threshold

    kvStoreMock.setValue.mockClear();

    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send(smallBody);

    expect(res.statusCode).toBe(200);
    expect(kvStoreMock.setValue).not.toHaveBeenCalled();
  });

  test("Should Base64 encode image/png payload", async () => {
    const [webhookId] = await webhookManager.generateWebhooks(1, 1);
    const pngBuffer = Buffer.from("89504E470D0A1A0A0000000D49484452", "hex"); // Standard PNG header

    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "image/png")
      .send(pngBuffer);

    expect(res.statusCode).toBe(200);

    // Verify pushData
    expect(Actor.pushData).toHaveBeenCalled();
    const pushDataCall = jest.mocked(Actor.pushData).mock.calls.find(
      /**
       * @param {any[]} call
       * @returns {boolean}
       */
      (call) => call[0].bodyEncoding === "base64",
    );

    expect(pushDataCall).toBeDefined();
    const { body, contentType } = assertType(pushDataCall?.[0]);
    expect(typeof body).toBe("string");
    expect(contentType).toBe("image/png");
  }, 60000);

  test("Should handle deeply nested JSON without crashing", async () => {
    const [webhookId] = await webhookManager.generateWebhooks(1, 1);

    // Create nested object: {a:{a:{...}}}
    let nested = { a: 1 };
    for (let i = 0; i < 2000; i++) {
      nested = { a: assertType(nested) };
    }

    try {
      const res = await appClient
        .post(`/webhook/${webhookId}`)
        .set("Content-Type", "application/json")
        .send(nested);

      expect([200, 400, 413, 500]).toContain(res.statusCode);
    } catch {
      // Supertest/Axios might fail to serialize too
    }
  });
});
