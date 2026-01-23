import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { sleep, assertType } from "../setup/helpers/test-utils.js";
import {
  useMockCleanup,
  useConsoleSpy,
} from "../setup/helpers/test-lifecycle.js";

// Mock Apify and axios using shared components
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true });

const { createDatasetMock } = await import("../setup/helpers/shared-mocks.js");

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const axios = (await import("axios")).default;
const { Actor } = await import("apify");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Resilience & Retry Tests", () => {
  /** @type {string} */
  let webhookId;

  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  useConsoleSpy("log", "warn", "error");

  beforeAll(async () => {
    // Disable logs for cleaner output
    ({ appClient, teardownApp } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
    jest.restoreAllMocks();
  });

  useMockCleanup();

  describe("/replay Retroactive Retries", () => {
    test("should retry 3 times on transient network error (ECONNABORTED)", async () => {
      const mockItem = {
        id: "evt_retry",
        webhookId,
        method: "POST",
        body: "{}",
        headers: {},
      };

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock([mockItem]));

      // Mock axios to fail twice then succeed
      jest
        .mocked(axios)
        .mockRejectedValueOnce({ code: "ECONNABORTED" })
        .mockRejectedValueOnce({ code: "ECONNABORTED" })
        .mockResolvedValueOnce({ status: 200, data: "OK" });

      const res = await appClient
        .get(`/replay/${webhookId}/evt_retry`)
        .query({ url: "http://target.com" });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("Replayed");
      expect(res.body.targetUrl).toBe("http://target.com");
      expect(res.body.targetResponseBody).toBe("OK");
      // Initial call + 2 retries = 3 calls total
      expect(axios).toHaveBeenCalledTimes(3);
    }, 15000); // Increase timeout for backoff

    test("should stop after 3 failed attempts and return 504", async () => {
      const mockItem = {
        id: "evt_fail",
        webhookId,
        method: "POST",
        body: "{}",
        headers: {},
      };

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock([mockItem]));

      // Always fail
      jest.mocked(axios).mockRejectedValue({ code: "ECONNABORTED" });

      const res = await appClient
        .get(`/replay/${webhookId}/evt_fail`)
        .query({ url: "http://target.com" });

      expect(res.statusCode).toBe(504);
      expect(res.body.error).toBe("Replay failed");
      expect(axios).toHaveBeenCalledTimes(3);
    }, 15000);

    test("should NOT retry on permanent errors (e.g. generic failure)", async () => {
      const mockItem = {
        id: "evt_generic",
        webhookId,
        method: "POST",
        body: "{}",
        headers: {},
      };

      jest
        .mocked(Actor.openDataset)
        .mockResolvedValue(createDatasetMock([mockItem]));

      jest.mocked(axios).mockRejectedValueOnce(new Error("Generic Failure"));

      const res = await appClient
        .get(`/replay/${webhookId}/evt_generic`)
        .query({ url: "http://target.com" });

      expect(res.statusCode).toBe(500);
      expect(axios).toHaveBeenCalledTimes(1);
    });
  });

  describe("Background Tasks Resilience", () => {
    test("should NOT block response if background tasks are slow (Timeout Verification)", async () => {
      // Mock Actor.pushData to be very slow
      jest.mocked(Actor.pushData).mockImplementation(async () => {
        await sleep(1000);
        return assertType(undefined);
      });

      const startTime = Date.now();
      const res = await appClient
        .post(`/webhook/${webhookId}`)
        .send({ test: "slow-bg" });

      const duration = Date.now() - startTime;

      expect(res.statusCode).toBe(200);
      // Explicitly assert that pushData was invoked (even if background tasks were slow/timed out internally)
      expect(Actor.pushData).toHaveBeenCalled();

      // In test mode, background timeout is 100ms. The response should be received quickly.
      // We use a 900ms threshold to account for CI overhead and prevent flake,
      // while preserving the assertion that we didn't wait for the 1000ms mock.
      expect(duration).toBeLessThan(900);
    });
  });
});
