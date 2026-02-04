import { describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
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

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 */

describe("Replay Route", () => {
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;

  beforeEach(() => {
    res = createMockResponse();
    next = createMockNextFunction();
    logRepositoryMock.getLogById.mockReset();
    logRepositoryMock.findLogs.mockReset();
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: true,
      href: "http://example.com",
      host: "example.com",
    });
    // getValue is now on shared apifyMock
    apifyMock.getValue.mockReset();
    axiosMock.mockReset();
  });

  const handler = () => createReplayHandler();

  test("should return 400 if url is missing", async () => {
    req = createMockRequest({ query: {} }); // no url
    await handler()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing 'url' parameter" });
  });

  test("should return 400 on SSRF failure", async () => {
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: false,
      error: "Blocked IP",
    });
    req = createMockRequest({ query: { url: "http://bad.com" } });
    await handler()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Blocked IP" });
  });

  test("should return 404 if log not found", async () => {
    logRepositoryMock.getLogById.mockResolvedValue(null);
    req = createMockRequest({
      params: { itemId: "missing" },
      query: { url: "http://example.com" },
    });
    await handler()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
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

    axiosMock.mockResolvedValue({ status: 200, data: "OK" });

    req = createMockRequest({
      params: { itemId: "log_1", webhookId: "wh_1" },
      query: { url: "http://example.com" },
    });

    await handler()(req, res, next);

    // Check axios call
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://example.com",
        headers: expect.objectContaining({
          "valid-header": "keep",
          "X-Apify-Replay": "true",
        }),
      }),
    );

    // Should NOT contain masked or ignored headers
    const callArgs = axiosMock.mock.calls[0][0];
    expect(callArgs.headers).not.toHaveProperty("authorization");
    expect(callArgs.headers).not.toHaveProperty("ignored-header");

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Replayed" }),
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
      .mockResolvedValueOnce({ status: 200, data: "OK" });

    req = createMockRequest({
      params: { itemId: "log_1" },
      query: { url: "http://example.com" },
    });

    await handler()(req, res, next);

    expect(axiosMock).toHaveBeenCalledTimes(2); // Initial + 1 retry
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Replayed" }),
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      "Replay attempt failed, retrying",
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
      query: { url: "http://example.com" },
    });

    await handler()(req, res, next);

    // Default retries mocked as 3
    expect(axiosMock).toHaveBeenCalledTimes(3);
    // ECONNRESET fails to catch block which returns 500 (unless timeout)
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test("should hydrate offloaded payload from KVS", async () => {
    /** @type {LogEntry} */
    const mockLog = assertType({
      id: "log_1",
      body: { data: storageHelperMock.OFFLOAD_MARKER_SYNC, key: "kvs_key" },
    });
    logRepositoryMock.getLogById.mockResolvedValue(mockLog);

    apifyMock.getValue.mockResolvedValue(
      assertType({
        hydrated: true,
      }),
    );
    axiosMock.mockResolvedValue({ status: 200 });

    req = createMockRequest({
      params: { itemId: "log_1" },
      query: { url: "http://example.com" },
    });

    await handler()(req, res, next);

    expect(apifyMock.getValue).toHaveBeenCalledWith("kvs_key");
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { hydrated: true },
      }),
    );
  });

  test("should handle array url parameter (take first)", async () => {
    req = createMockRequest({
      query: { url: ["http://first.com", "http://second.com"] },
    });
    await handler()(req, res, next);

    // Should validate the first URL
    expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledTimes(1);
    expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(
      "http://first.com",
    );
  });

  test("should return specific error for hostname resolution failure", async () => {
    const { SSRF_ERRORS } = await import("../../src/utils/ssrf.js");
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: false,
      error: SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED,
    });

    req = createMockRequest({ query: { url: "http://bad-host.com" } });
    await handler()(req, res, next);

    const { ERROR_MESSAGES } = await import("../../src/consts.js");
    expect(res.status).toHaveBeenCalledWith(400);
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
      query: { url: "http://example.com" },
    });

    await handler()(req, res, next);

    expect(logRepositoryMock.findLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: [{ operator: "eq", value: timestampId }],
        webhookId: "wh_1",
      }),
    );
    // Should proceed to replay
    expect(axiosMock).toHaveBeenCalled();
  });
});
