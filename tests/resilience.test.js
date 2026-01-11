import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";

// Mock Apify and axios using shared components
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});
const { createDatasetMock } = await import("./helpers/shared-mocks.js");

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

const request = (await import("supertest")).default;
const { app, initialize, shutdown, webhookManager } =
  await import("../src/main.js");
const axios = (await import("axios")).default;
const { Actor } = await import("apify");

describe("Resilience & Retry Tests", () => {
  /** @type {string} */
  let webhookId;

  beforeAll(async () => {
    // Disable logs for cleaner output
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    await initialize();
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

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
        .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));

      // Mock axios to fail twice then succeed
      jest
        .mocked(axios)
        .mockRejectedValueOnce({ code: "ECONNABORTED" })
        .mockRejectedValueOnce({ code: "ECONNABORTED" })
        .mockResolvedValueOnce({ status: 200, data: "OK" });

      const res = await request(app)
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
        .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));

      // Always fail
      jest.mocked(axios).mockRejectedValue({ code: "ECONNABORTED" });

      const res = await request(app)
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
        .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));

      // Axios returns a response with 404 status (no exception thrown if validateStatus allows it)
      // But in our Replay logic we use validateStatus: () => true, so it wont throw.
      // Wait, let's test a real error that SHOULDNT be retried, like a generic Error without code
      jest.mocked(axios).mockRejectedValueOnce(new Error("Generic Failure"));

      const res = await request(app)
        .get(`/replay/${webhookId}/evt_generic`)
        .query({ url: "http://target.com" });

      expect(res.statusCode).toBe(500);
      expect(axios).toHaveBeenCalledTimes(1);
    });
  });

  describe("Background Tasks Resilience", () => {
    test("should NOT block response if background tasks are slow (Timeout Verification)", async () => {
      // Mock Actor.pushData to be very slow
      jest.mocked(Actor.pushData).mockImplementation(
        /** @type {any} */ (
          () =>
            new Promise((resolve) => {
              const t = setTimeout(
                () => resolve(/** @type {any} */ (undefined)),
                1000,
              );
              if (t.unref) t.unref();
            })
        ),
      );

      const startTime = Date.now();
      const res = await request(app)
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
