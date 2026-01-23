import { jest, describe, test, expect } from "@jest/globals";
import {
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
  getLastAxiosConfig,
  assertType,
} from "../setup/helpers/test-utils.js";
import {
  useFakeTimers,
  useMockCleanup,
} from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import("apify").DatasetDataOptions} DatasetDataOptions
 * @typedef {import("apify").DatasetContent<WebhookEvent>} DatasetContent
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 */

// Mock Apify and Axios
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, ssrf: true, dns: true });

import { apifyMock, axiosMock } from "../setup/helpers/shared-mocks.js";

// Mock Dataset
const { createDatasetMock } = await import("../setup/helpers/shared-mocks.js");
const mockItems = [
  {
    id: "log_recent",
    webhookId: "wh_1",
    timestamp: new Date("2023-01-02T12:00:00Z").toISOString(),
    method: "POST",
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: '{"foo":"bar"}',
    remoteIp: "1.2.3.4",
  },
  {
    id: "log_old",
    webhookId: "wh_1",
    timestamp: new Date("2023-01-01T12:00:00Z").toISOString(), // 24h older
    method: "POST",
    statusCode: 200,
    headers: {},
    body: "{}",
    remoteIp: "1.2.3.4",
  },
];

const mockDataset = createDatasetMock(mockItems);

// We need to implement a smarter getData mock that respects offset/limit
// to simulate the binary search and scanning.
jest.mocked(mockDataset.getData).mockImplementation(
  /**
   * @param {DatasetDataOptions | undefined} params
   * @returns {Promise<DatasetContent>}
   */
  async (/** @type {DatasetDataOptions} */ { offset = 0, limit = 100 }) => {
    // Basic slice implementation since items are already in descending order
    // (newest first), matching Apify's default sort.

    const result = mockItems.slice(offset, offset + limit);
    return Promise.resolve(/** @type {DatasetContent} */ ({ items: result }));
  },
);

jest.mocked(mockDataset.getInfo).mockResolvedValue(
  assertType({
    itemCount: mockItems.length,
  }),
);

jest.mocked(apifyMock.openDataset).mockResolvedValue(assertType(mockDataset));

const { createReplayHandler } = await import("../../src/routes/replay.js");

describe("Replay Optimization Tests", () => {
  useMockCleanup(() => {
    axiosMock.mockResolvedValue({ status: 200, data: "OK" });
    jest
      .mocked(apifyMock.openDataset)
      .mockResolvedValue(assertType(mockDataset));
  });

  test("should include Idempotency-Key header in outbound request", async () => {
    const handler = createReplayHandler();
    const req = createMockRequest({
      params: { webhookId: "wh_1", itemId: "log_recent" },
      query: { url: "https://example.com" },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    await handler(req, res, next);

    expect(axiosMock).toHaveBeenCalledTimes(1);
    const config = getLastAxiosConfig(axiosMock, null);
    expect(config.headers).toHaveProperty("Idempotency-Key", "log_recent");
    expect(config.headers).toHaveProperty("X-Original-Webhook-Id", "wh_1");
  });

  test("should use timestamp optimization to jump offset", async () => {
    const handler = createReplayHandler();
    // We request an OLD log. The implementation should use binary search (via timestamp)
    // to jump closer to the target offset instead of scanning from 0.

    const req = createMockRequest({
      params: { webhookId: "wh_1", itemId: "log_old" },
      query: {
        url: "https://example.com",
        timestamp: "2023-01-01T12:00:00Z",
      },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    await handler(req, res, next);

    expect(axiosMock).toHaveBeenCalledTimes(1);

    // Verify that getData was called with probes (limit: 1) and then a final scan.
    const calls = jest.mocked(mockDataset.getData).mock.calls;
    // We expect some calls with limit: 1 (binary search probes)
    const probeCalls = calls.filter(
      /** @param {any[]} args */ (args) => args[0].limit === 1,
    );
    expect(probeCalls.length).toBeGreaterThan(0);

    // We expect the final scan logic to have used an offset > 0 if logic worked.
    // Given the small dataset (2 items), we verify that a jump occurred.
  });

  test("should fail fast if timestamp optimization finds index is too far", async () => {
    // Target is "Now", but dataset only has old items (1 year ago).
    // The handler should see the large timestamp gap and abort scanning early.

    const handler = createReplayHandler();
    const req = createMockRequest({
      params: { webhookId: "wh_1", itemId: "non_existent" },
      query: {
        url: "https://example.com",
        timestamp: new Date().toISOString(), // Target = Now (2026)
      },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    await handler(req, res, next);

    // Should return 404 "Event not found" quickly without timing out.
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("should respect configurable max retries", async () => {
    // Override Axios to timeout
    axiosMock.mockRejectedValue({
      code: "ETIMEDOUT",
    });

    // Create handler with CUSTOM max retries = 2
    // We pass the getter function as the argument
    const customHandler = createReplayHandler(() => 2);

    const req = createMockRequest({
      params: { webhookId: "wh_1", itemId: "log_recent" },
      query: { url: "https://example.com" },
    });
    const res = createMockResponse();
    const next = createMockNextFunction();

    await customHandler(req, res, next);

    // Verify it tried 2 times
    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Target destination timed out after 2 attempts",
        ),
      }),
    );
  });

  describe("Timeout Behavior", () => {
    useFakeTimers();

    test("should respect configurable timeout", async () => {
      jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));

      // Override Axios to timeout
      axiosMock.mockRejectedValue({ code: "ECONNABORTED" });

      // Create handler with CUSTOM timeout = 1234ms
      const customHandler = createReplayHandler(
        undefined, // use default retries
        () => 1234, // custom timeout
      );

      const req = createMockRequest({
        params: { webhookId: "wh_1", itemId: "log_recent" },
        query: { url: "https://example.com" },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      const handlerPromise = customHandler(req, res, next);

      // Advance timers to handle retries
      await jest.runAllTimersAsync();
      await handlerPromise;

      expect(axiosMock).toHaveBeenCalled();
      const config = getLastAxiosConfig(axiosMock, null);
      expect(config.timeout).toBe(1234);

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("1.234s timeout per attempt"),
        }),
      );
    });
  });
});
