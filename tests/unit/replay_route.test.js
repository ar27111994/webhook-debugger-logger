import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import {
  apifyMock,
  axiosMock,
  ssrfMock,
  logRepositoryMock,
  storageHelperMock,
  loggerMock,
  constsMock,
} from "../setup/helpers/shared-mocks.js";

// 1. Setup Common Mocks
await setupCommonMocks({
  apify: true,
  axios: true,
  ssrf: true,
  logger: true,
  repositories: true,
  storage: true,
  consts: true,
});

const { createReplayHandler } = await import("../../src/routes/replay.js");
const { forwardingService } = await import("../../src/services/index.js");

import { ERROR_MESSAGES } from "../../src/consts/errors.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 */

jest.setTimeout(30000);

describe("Replay Route", () => {
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;
  /** @type {jest.SpiedFunction<typeof forwardingService.sendSafeRequest>} */
  let spy;

  beforeEach(() => {
    res = createMockResponse();
    next = createMockNextFunction();
    logRepositoryMock.getLogById.mockReset();
    logRepositoryMock.findLogs.mockReset();
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: true,
      href: "https://example.com",
      host: "example.com",
    });
    // getValue is now on shared apifyMock
    apifyMock.getValue.mockReset();
    axiosMock.mockClear();
    spy = jest.spyOn(forwardingService, "sendSafeRequest");
    apifyMock.getValue.mockReset();
    axiosMock.mockClear();
    spy = jest.spyOn(forwardingService, "sendSafeRequest");
    // Ensure max retries is manageable
    constsMock.APP_CONSTS.MAX_REPLAY_RETRIES = 3;
  });

  const handler = () => createReplayHandler();

  test("should return HTTP_STATUS.BAD_REQUEST if url is missing", async () => {
    req = createMockRequest({ query: {} }); // no url
    await handler()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      error: ERROR_MESSAGES.MISSING_URL,
    });
  });

  test("should return HTTP_STATUS.BAD_REQUEST on SSRF failure", async () => {
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: false,
      error: "Blocked IP",
    });
    req = createMockRequest({ query: { url: "https://bad.com" } });
    await handler()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({ error: "Blocked IP" });
  });

  test("should return HTTP_STATUS.NOT_FOUND if log not found", async () => {
    logRepositoryMock.getLogById.mockResolvedValue(null);
    req = createMockRequest({
      params: { itemId: "missing" },
      query: { url: "https://example.com" },
    });
    await handler()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.NOT_FOUND);
  });

  test("should strip sensitive headers and replay successfully", async () => {
    /** @type {LogEntry} */
    const mockLog = assertType({
      id: "log_1",
      method: "POST",
      body: { foo: "bar" },
      headers: {
        authorization: "[MASKED]",
        "ignored-header": "val",
        "valid-header": "keep",
      },
    });
    logRepositoryMock.getLogById.mockResolvedValue(mockLog);

    axiosMock.mockResolvedValue({
      status: constsMock.HTTP_STATUS.OK,
      data: "OK",
    });

    req = createMockRequest({
      params: { itemId: "log_1", webhookId: "wh_1" },
      query: { url: "https://example.com" },
    });

    await handler()(req, res, next);

    // Check forwardingService call using the spy
    expect(spy).toHaveBeenCalledWith(
      "https://example.com",
      "POST",
      { foo: "bar" }, // body matches log
      expect.objectContaining({
        "valid-header": "keep",
        "X-Apify-Replay": "true",
      }),
      expect.any(Object), // Options object
      expect.any(AbortSignal), // Signal
    );

    // Should NOT contain masked or ignored headers
    const callArgs = axiosMock.mock.calls[0][0];
    expect(callArgs.headers).not.toHaveProperty("authorization");
    expect(callArgs.headers).not.toHaveProperty("authorization");
    // "ignored-header" is not in the standard ignore list, so it remains unless explicitly filtered by route logic implementation which we are testing integration with.
    // Use valid-header expectation as positive check.
    expect(callArgs.headers).toHaveProperty("valid-header", "keep");

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: constsMock.REPLAY_STATUS_LABELS.REPLAYED,
      }),
    );
  });

  test("should retry on transient errors", async () => {
    /** @type {LogEntry} */
    const mockLog = assertType({
      id: "log_1",
      method: "GET",
    });
    logRepositoryMock.getLogById.mockResolvedValue(mockLog);

    /** @type {CommonError} */
    const error = new Error("Connection Reset");
    error.code = "ECONNRESET";

    axiosMock
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ status: constsMock.HTTP_STATUS.OK, data: "OK" });

    req = createMockRequest({
      params: { itemId: "log_1" },
      query: { url: "https://example.com" },
    });

    await handler()(req, res, next);

    expect(spy).toHaveBeenCalledTimes(1); // Service method called once
    // Axios called twice (1st fail, 2nd success)
    expect(axiosMock).toHaveBeenCalledTimes(2);

    const { ERROR_MESSAGES } = await import("../../src/consts/errors.js");
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      ERROR_MESSAGES.FORWARD_FAILED,
    );
  });

  test("should fail after exhausting retries", async () => {
    /** @type {LogEntry} */
    const mockLog = assertType({
      id: "log_1",
      method: "GET",
    });
    logRepositoryMock.getLogById.mockResolvedValue(mockLog);

    /** @type {CommonError} */
    const error = new Error("Connection Reset");
    error.code = "ECONNRESET";

    axiosMock.mockRejectedValue(error);

    req = createMockRequest({
      params: { itemId: "log_1" },
      query: { url: "https://example.com" },
    });

    await handler()(req, res, next);

    // Default retries mocked as 3 via constsMock override
    const DEFAULT_RETRIES = 3;
    expect(spy).toHaveBeenCalledTimes(1); // Service called once
    // Implementation treats maxRetries as total attempts loop limit
    expect(axiosMock).toHaveBeenCalledTimes(DEFAULT_RETRIES);

    // The forwarding service throws AFTER retries, so handler counts as 500
    expect(res.status).toHaveBeenCalledWith(
      constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
  });

  test("should hydrate offloaded payload from KVS", async () => {
    /** @type {LogEntry} */
    const mockLog = assertType({
      id: "log_1",
      method: "POST",
      body: { data: storageHelperMock.OFFLOAD_MARKER_SYNC, key: "kvs_key" },
    });
    logRepositoryMock.getLogById.mockResolvedValue(mockLog);

    apifyMock.getValue.mockResolvedValue(
      assertType({
        hydrated: true,
      }),
    );
    axiosMock.mockResolvedValue({ status: constsMock.HTTP_STATUS.OK });

    req = createMockRequest({
      params: { itemId: "log_1" },
      query: { url: "https://example.com" },
    });

    await handler()(req, res, next);

    expect(apifyMock.getValue).toHaveBeenCalledWith("kvs_key");
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hydrated: true }), // The body
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  test("should handle array url parameter (take first)", async () => {
    req = createMockRequest({
      query: { url: ["https://first.com", "https://second.com"] },
    });
    await handler()(req, res, next);

    // Should validate the first URL
    expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledTimes(1);
    expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(
      "https://first.com",
    );
  });

  test("should return specific error for hostname resolution failure", async () => {
    const { SSRF_ERRORS } = await import("../../src/consts/index.js");
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: false,
      error: SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED,
    });

    req = createMockRequest({ query: { url: "https://bad-host.com" } });
    await handler()(req, res, next);

    const { ERROR_MESSAGES } = await import("../../src/consts/errors.js");
    expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      error: ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED,
    });
  });

  test("should fallback to timestamp lookup if ID not found", async () => {
    logRepositoryMock.getLogById.mockResolvedValue(null);

    // Simulate finding by timestamp
    /** @type {LogEntry} */
    const mockItem = assertType({
      id: "log_timestamp_match",
      webhookId: "wh_1",
    });
    logRepositoryMock.findLogs.mockResolvedValue(
      assertType({ items: [mockItem] }),
    );

    const timestampId = new Date().toISOString();
    req = createMockRequest({
      params: { itemId: timestampId, webhookId: "wh_1" },
      query: { url: "https://example.com" },
    });

    await handler()(req, res, next);

    expect(logRepositoryMock.findLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: [{ operator: "eq", value: timestampId }],
        webhookId: "wh_1",
      }),
    );
    // Should proceed to replay
    expect(spy).toHaveBeenCalled();
  });
});
