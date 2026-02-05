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
import { HTTP_STATUS } from "../../src/consts.js";

/**
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import("apify").DatasetDataOptions} DatasetDataOptions
 * @typedef {import("apify").DatasetContent<WebhookEvent>} DatasetContent
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 */

// Mock Apify and Axios
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
await setupCommonMocks({
  axios: true,
  apify: true,
  ssrf: true,
  dns: true,
  logger: true,
});

import { axiosMock } from "../setup/helpers/shared-mocks.js";

// Mock Dataset
const { Actor } = await import("apify");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");
const mockItem = {
  id: "log_recent",
  webhookId: "wh_1",
  timestamp: new Date("2023-01-02T12:00:00Z").toISOString(),
  method: "POST",
  statusCode: HTTP_STATUS.OK,
  headers: { "content-type": "application/json" },
  body: '{"foo":"bar"}',
  remoteIp: "1.2.3.4",
};

const { createReplayHandler } = await import("../../src/routes/replay.js");

describe("Replay Optimization Tests", () => {
  useMockCleanup(() => {
    axiosMock.mockResolvedValue({ status: HTTP_STATUS.OK, data: "OK" });
    jest
      .spyOn(logRepository, "getLogById")
      .mockResolvedValue(assertType(mockItem));
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
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.GATEWAY_TIMEOUT);
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

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.GATEWAY_TIMEOUT);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("1.234s timeout per attempt"),
        }),
      );
    });
  });

  describe("KVS Hydration Edge Cases", () => {
    const offloadedItem = {
      ...mockItem,
      body: { data: "[OFFLOADED_TO_KVS]", key: "k123" },
    };

    test("should log warn and send metadata if hydration returns null", async () => {
      jest
        .spyOn(logRepository, "getLogById")
        .mockResolvedValue(assertType(offloadedItem));
      Actor.getValue = assertType(
        jest.fn().mockResolvedValue(assertType(null)),
      );

      const handler = createReplayHandler();
      const req = createMockRequest({
        params: { webhookId: "wh_1", itemId: "log_recent" },
        query: { url: "https://example.com" },
      });
      const res = createMockResponse();

      await handler(req, res, jest.fn());

      const config = getLastAxiosConfig(axiosMock, null);
      // If hydration fails, it sends the metadata (initial body)
      expect(config.data).toEqual(offloadedItem.body);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ kvsKey: "k123" }),
        "Failed to find KVS key, sending metadata instead",
      );
    });

    test("should log error if hydration throws", async () => {
      jest
        .spyOn(logRepository, "getLogById")
        .mockResolvedValue(assertType(offloadedItem));
      Actor.getValue = assertType(
        jest.fn().mockRejectedValue(assertType(new Error("KVS Crash"))),
      );

      const handler = createReplayHandler();
      const req = createMockRequest({
        params: { webhookId: "wh_1", itemId: "log_recent" },
        query: { url: "https://example.com" },
      });
      const res = createMockResponse();

      await handler(req, res, jest.fn());

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ kvsKey: "k123" }),
        "Error fetching KVS key",
      );
    });
  });

  describe("Retry Logic Edge Cases", () => {
    test("should throw early on non-transient errors", async () => {
      axiosMock.mockRejectedValue({ code: "ECONNREFUSED", message: "Refused" });

      const handler = createReplayHandler();
      const req = createMockRequest({
        params: { webhookId: "wh_1", itemId: "log_recent" },
        query: { url: "https://example.com" },
      });
      const res = createMockResponse();

      await handler(req, res, jest.fn());

      expect(axiosMock).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Refused" }),
      );
    });
  });
});
