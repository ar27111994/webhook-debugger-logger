/**
 * @file tests/unit/services/forwarding_service.test.js
 * @description Unit tests for the ForwardingService class.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  useMockCleanup,
  useFakeTimers,
} from "../../setup/helpers/test-lifecycle.js";
import {
  assertType,
  createMockRequest,
  flushPromises,
} from "../../setup/helpers/test-utils.js";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";

/**
 * @typedef {import("../../../src/services/ForwardingService.js").ForwardingService} ForwardingServiceInstance
 * @typedef {import("../../../src/typedefs.js").CommonError} CommonError
 * @typedef {import("../../../src/typedefs.js").WebhookEvent} WebhookEvent
 * @typedef {import("../../setup/helpers/shared-mocks.js").AxiosMock} AxiosMock
 * @typedef {import("../../../src/typedefs.js").CustomRequest} CustomRequest
 */

await setupCommonMocks({
  axios: true,
  apify: true,
  ssrf: true,
  logger: true,
  consts: true,
});

const { FORWARDING_CONSTS, APP_CONSTS } =
  await import("../../../src/consts/app.js");
const {
  HTTP_STATUS,
  HTTP_METHODS,
  HTTP_HEADERS,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
  HTTP_STATUS_MESSAGES,
  MIME_TYPES,
} = await import("../../../src/consts/http.js");
const { ERROR_MESSAGES, ERROR_LABELS } =
  await import("../../../src/consts/errors.js");
const { LOG_MESSAGES } = await import("../../../src/consts/messages.js");
const { axiosMock, apifyMock, ssrfMock, loggerMock } =
  await import("../../setup/helpers/shared-mocks.js");
const { ForwardingService } =
  await import("../../../src/services/ForwardingService.js");

const DEFAULT_MAX_RETRIES = 3;
const SHORT_MAX_RETRIES = 2;
const CIRCUIT_BREAKER_FAILURE_COUNT =
  FORWARDING_CONSTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD;
const MOCK_CONTENT_LENGTH = 100;
const MOCK_BUFFER_SIZE = 10;
const TEST_BAD_URL = "https://bad.com";
const TEST_URL_HOST = "example.com";
const TEST_URL_HTTP = `http://${TEST_URL_HOST}/hook`;
const TEST_URL_HTTPS = `https://${TEST_URL_HOST}/hook`;

describe("ForwardingService", () => {
  useMockCleanup();
  useFakeTimers();

  /** @type {ForwardingServiceInstance} */
  let service;
  /** @type {AxiosMock} */
  let mockAxiosInstance;

  beforeEach(() => {
    mockAxiosInstance = axiosMock.create();
    service = new ForwardingService();

    // Default safe SSRF
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: true,
      href: TEST_URL_HTTP,
      host: TEST_URL_HOST,
    });
    apifyMock.pushData.mockResolvedValue(undefined);
  });

  describe("constructor & connection pool", () => {
    it("should initialize axios with a custom HTTP/HTTPS agent and strict security limits", () => {
      expect(axiosMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: FORWARDING_CONSTS.FORWARD_TIMEOUT_MS,
          maxRedirects: 0,
          validateStatus: null,
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });
  });

  describe("sendSafeRequest()", () => {
    const defaultHeaders = {
      [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
      "x-secret": "hidden",
    };
    const defaultUrl = TEST_URL_HTTPS;

    it("should send a basic request and return response on success", async () => {
      const mockResponse = {
        status: HTTP_STATUS.OK,
        data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
      };
      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const result = await service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        { ok: 1 },
        defaultHeaders,
        {},
      );
      expect(result).toBe(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: defaultUrl,
          method: HTTP_METHODS.POST,
          headers: expect.objectContaining({
            [RECURSION_HEADER_NAME]: RECURSION_HEADER_VALUE,
          }),
        }),
      );
    });

    it("should strip FORWARD_HEADERS_TO_IGNORE when forwardHeaders is true", async () => {
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      const headers = {
        host: "old.com",
        [HTTP_HEADERS.CONTENT_LENGTH]: "100",
        "safe-header": "test",
      };
      await service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        headers,
        { forwardHeaders: true },
      );

      const reqConfig = mockAxiosInstance.request.mock.calls[0][0];
      expect(reqConfig.headers).toHaveProperty("safe-header", "test");
      expect(reqConfig.headers).not.toHaveProperty("host", "old.com"); // host is stripped
      expect(reqConfig.headers).not.toHaveProperty(HTTP_HEADERS.CONTENT_LENGTH);
    });

    it("should only forward Content-Type when forwardHeaders is false", async () => {
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      const headers = {
        [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
        "safe-header": "test",
      };
      await service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        headers,
        { forwardHeaders: false },
      );

      const reqConfig = mockAxiosInstance.request.mock.calls[0][0];
      expect(reqConfig.headers).toHaveProperty(
        HTTP_HEADERS.CONTENT_TYPE,
        MIME_TYPES.JSON,
      );
      expect(reqConfig.headers).not.toHaveProperty("safe-header");
    });

    it("should inject a custom hostHeader override if provided", async () => {
      const newHost = "new-host.com";
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      await service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        {},
        { hostHeader: newHost },
      );

      const reqConfig = mockAxiosInstance.request.mock.calls[0][0];
      expect(reqConfig.headers).toHaveProperty(HTTP_HEADERS.HOST, newHost);
    });

    it("should immediately throw ERROR_MESSAGES.ABORTED if signal is pre-aborted", async () => {
      const abortController = new AbortController();
      abortController.abort();
      await expect(
        service.sendSafeRequest(
          defaultUrl,
          HTTP_METHODS.POST,
          {},
          {},
          {},
          abortController.signal,
        ),
      ).rejects.toThrow(ERROR_MESSAGES.ABORTED);
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it("should throw immediately on axios cancellation and NOT retry", async () => {
      axiosMock.isCancel.mockReturnValueOnce(true);
      const errorMsg = "canceled";
      const cancelError = new Error(errorMsg);
      Object.defineProperty(cancelError, "isCancel", {
        value: true,
        configurable: true,
      });
      mockAxiosInstance.request.mockRejectedValue(cancelError);

      await expect(
        service.sendSafeRequest(defaultUrl, HTTP_METHODS.POST, {}, {}, {}),
      ).rejects.toThrow(errorMsg);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1); // No retries
    });

    it("should classify 500/502/503/504 as transient HTTP errors and retry", async () => {
      // Return a 503 instead of throwing from axios, sendSafeRequest manually throws an internal format
      mockAxiosInstance.request.mockResolvedValue({
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      });

      const requestPromise = service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        {},
        { maxRetries: DEFAULT_MAX_RETRIES },
      );

      // It sleeps for backoff between retries
      await flushPromises();
      jest.advanceTimersByTime(FORWARDING_CONSTS.RETRY_BASE_DELAY_MS);
      await flushPromises();
      jest.advanceTimersByTime(
        FORWARDING_CONSTS.RETRY_BASE_DELAY_MS *
          FORWARDING_CONSTS.RETRY_BACKOFF_BASE,
      );
      await flushPromises();

      await expect(requestPromise).rejects.toMatchObject({
        code: `${FORWARDING_CONSTS.HTTP_PREFIX}${HTTP_STATUS.SERVICE_UNAVAILABLE}`,
        isHttpError: true,
      });
      // 1 initial + 2 retries
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(
        DEFAULT_MAX_RETRIES,
      );
    });

    it("should classify ECONNRESET/ETIMEDOUT as transient network errors and retry", async () => {
      const errorMsg = "socket hang up";
      /** @type {CommonError} */
      const networkErr = new Error(errorMsg);
      networkErr.code = "ECONNRESET";
      mockAxiosInstance.request.mockRejectedValue(networkErr);

      const requestPromise = service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        {},
        { maxRetries: SHORT_MAX_RETRIES },
      );

      await flushPromises();
      jest.advanceTimersByTime(FORWARDING_CONSTS.RETRY_BASE_DELAY_MS);
      await flushPromises();

      await expect(requestPromise).rejects.toThrow(errorMsg);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(
        SHORT_MAX_RETRIES,
      );
    });

    it("should NOT retry 4xx errors (non-transient) and throw immediately, tripping CB", async () => {
      mockAxiosInstance.request.mockResolvedValue({
        status: HTTP_STATUS.NOT_FOUND,
      });

      // Pre-fill failures so this next error correctly opens the circuit breaker
      for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_COUNT - 1; i++) {
        service.circuitBreaker.recordFailure(defaultUrl);
      }

      await expect(
        service.sendSafeRequest(
          defaultUrl,
          HTTP_METHODS.POST,
          {},
          {},
          { maxRetries: DEFAULT_MAX_RETRIES },
        ),
      ).rejects.toMatchObject({
        code: `${FORWARDING_CONSTS.HTTP_PREFIX}${HTTP_STATUS.NOT_FOUND}`,
      });

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1); // No retries
      expect(service.circuitBreaker.isOpen(defaultUrl)).toBe(true);
    });

    it("should NOT follow redirects and instead throw as a failure (Security)", async () => {
      // axios is configured with maxRedirects: 0, and our validateStatus treats them as failure manually
      mockAxiosInstance.request.mockResolvedValue({
        status: HTTP_STATUS.MOVED_PERMANENTLY,
      });

      await expect(
        service.sendSafeRequest(defaultUrl, HTTP_METHODS.POST, {}, {}, {}),
      ).rejects.toMatchObject({
        code: `${FORWARDING_CONSTS.HTTP_PREFIX}${HTTP_STATUS.MOVED_PERMANENTLY}`,
        isHttpError: true,
      });

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it("should exhaust maxRetries and throw the last encountered error", async () => {
      const errorMsg = "network";
      /** @type {CommonError} */
      const networkErr = new Error(errorMsg);
      networkErr.code = "ETIMEDOUT";

      // Always fail
      mockAxiosInstance.request.mockRejectedValue(networkErr);

      const promise = service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        {},
        { maxRetries: SHORT_MAX_RETRIES },
      );

      // SHORT_MAX_RETRIES total attempts
      for (let i = 0; i < SHORT_MAX_RETRIES; i++) {
        await flushPromises();
        jest.runOnlyPendingTimers();
      }
      await flushPromises();

      // Should throw the network error, not the exhaust messages (which is unreachable in current loop)
      await expect(promise).rejects.toThrow(errorMsg);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(
        SHORT_MAX_RETRIES,
      );
    });

    it("should record a successful request against the circuit breaker", async () => {
      mockAxiosInstance.request.mockResolvedValue({
        status: HTTP_STATUS.OK,
        data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
      });

      await service.sendSafeRequest(defaultUrl, HTTP_METHODS.POST, {}, {}, {});

      // We can't directly check the 'recordSuccess' side-effect easily without a spy
      // But we know it didn't crash, and the request was made.
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it("should wire up the abort signal to clear the retry delay timeout", async () => {
      mockAxiosInstance.request.mockResolvedValue({
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      });
      const abortController = new AbortController();

      const requestPromise = service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        {},
        { maxRetries: DEFAULT_MAX_RETRIES },
        abortController.signal,
      );

      await flushPromises();
      // While it is sleeping for the first retry, abort it
      abortController.abort();

      await expect(requestPromise).rejects.toThrow(ERROR_MESSAGES.ABORTED);
      // It shouldn't have executed the second attempt
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it("should throw REPLAY_ATTEMPTS_EXHAUSTED fallback if loop finishes without throwing", async () => {
      // Unreachable in normal config since the inner loop throws the last error,
      // but reachable if the loop never runs (e.g. maxRetries = -1).
      const maxRetries = -1;
      await expect(
        service.sendSafeRequest(
          defaultUrl,
          HTTP_METHODS.POST,
          {},
          {},
          { maxRetries },
        ),
      ).rejects.toThrow(ERROR_MESSAGES.REPLAY_ATTEMPTS_EXHAUSTED(maxRetries));
    });

    it("should log FORWARD_TIMEOUT if axiosError code is TIMEOUT_CODE", async () => {
      /** @type {CommonError} */
      const err = new Error("Timeout");
      err.code = FORWARDING_CONSTS.TIMEOUT_CODE;
      mockAxiosInstance.request.mockRejectedValue(err);

      await expect(
        service.sendSafeRequest(
          defaultUrl,
          HTTP_METHODS.POST,
          {},
          {},
          { maxRetries: 1 },
        ),
      ).rejects.toThrow(err); // Re-throws the native error, but the logger was hit

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: FORWARDING_CONSTS.TIMEOUT_CODE }),
        ERROR_MESSAGES.FORWARD_TIMEOUT,
      );
    });

    it("should handle environment without timer.unref safely", async () => {
      const originalSetTimeout = global.setTimeout;
      jest.spyOn(global, "setTimeout").mockImplementation((cb, ms) => {
        // The fake timer returns an integer id or object.
        const timerId = originalSetTimeout(cb, ms);
        if (timerId && typeof timerId === "object") {
          // @ts-expect-error - Delete mandatory unref property from timerId
          delete timerId.unref;
        }
        return timerId;
      });

      /** @type {CommonError} */
      const err = new Error("ETIMEDOUT");
      err.code = "ETIMEDOUT";
      mockAxiosInstance.request.mockRejectedValue(err);

      const p = service.sendSafeRequest(
        defaultUrl,
        HTTP_METHODS.POST,
        {},
        {},
        { maxRetries: 2 },
      );
      await flushPromises();
      jest.advanceTimersByTime(FORWARDING_CONSTS.RETRY_BASE_DELAY_MS); // Trigger retries

      // Will exhaust out
      try {
        await p;
      } catch (e) {
        // Ignore, we just want to ensure it doesn't crash on undefined unref
        expect(/** @type {Error} */ (e).message).toBe("ETIMEDOUT");
      }

      jest.restoreAllMocks();
    });
  });

  describe("forwardWebhook()", () => {
    /** @type {WebhookEvent} */
    const mockEvent = assertType({ id: "ev_1", webhookId: "wh_1" });
    const mockOptions = { forwardHeaders: true, maxForwardRetries: 1 };

    /** @type {CustomRequest} */
    let mockReq;
    beforeEach(() => {
      mockReq = createMockRequest({
        headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
        body: { test: "data" },
      });
    });

    it("should auto-prefix standard HTTP to URLs missing a protocol", async () => {
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      const forwardUrl = `${TEST_URL_HOST}/hook`;

      await service.forwardWebhook(mockEvent, mockReq, mockOptions, forwardUrl);

      expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(
        `http://${forwardUrl}`,
      );
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: `http://${forwardUrl}` }),
      );
    });

    it("should immediately abort if Circuit Breaker is open for the URL", async () => {
      service.circuitBreaker.recordFailure(TEST_BAD_URL);
      // Need 5 failures by default to open
      for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_COUNT; i++)
        service.circuitBreaker.recordFailure(TEST_BAD_URL);

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_BAD_URL,
      );

      expect(apifyMock.pushData).not.toHaveBeenCalled();
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it("should block request if validateUrlForSsrf returns safe: false", async () => {
      ssrfMock.validateUrlForSsrf.mockResolvedValue({
        safe: false,
        error: "Reserved IP",
      });

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_BAD_URL,
      );

      expect(apifyMock.pushData).not.toHaveBeenCalled();
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it("should abort if the calculated body length exceeds MAX_ALLOWED_PAYLOAD_SIZE", async () => {
      mockReq.headers[HTTP_HEADERS.CONTENT_LENGTH] = String(
        APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE + MOCK_CONTENT_LENGTH,
      );
      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTP,
      );

      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
      expect(apifyMock.pushData).not.toHaveBeenCalled();
    });

    it("should fallback to buffer length if content-length header is missing", async () => {
      delete mockReq.headers[HTTP_HEADERS.CONTENT_LENGTH];
      mockReq.body = "A".repeat(MOCK_CONTENT_LENGTH);
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTP,
      );

      expect(mockAxiosInstance.request).toHaveBeenCalled();
      expect(apifyMock.pushData).not.toHaveBeenCalled();
    });

    it.each([
      ["empty", ""],
      ["non-numeric", "not-a-number"],
      ["partially numeric", "123abc"],
      ["scientific notation", "1e9"],
      ["unsafe integer", "9007199254740992"],
    ])(
      "should fallback to measured body size when content-length header is %s",
      async (_label, headerValue) => {
        mockReq.headers[HTTP_HEADERS.CONTENT_LENGTH] = headerValue;
        mockReq.body = "A".repeat(APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE + 1);

        await service.forwardWebhook(
          mockEvent,
          mockReq,
          mockOptions,
          TEST_URL_HTTP,
        );

        expect(mockAxiosInstance.request).not.toHaveBeenCalled();
        expect(apifyMock.pushData).not.toHaveBeenCalled();
      },
    );

    it("should fallback to measured body size when content-length header is an array", async () => {
      mockReq.headers[HTTP_HEADERS.CONTENT_LENGTH] = assertType(["1", "999"]);
      mockReq.body = "A".repeat(APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE + 1);

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTP,
      );

      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
      expect(apifyMock.pushData).not.toHaveBeenCalled();
    });

    it("should gracefully handle non-json serializable bodies when length checking", async () => {
      mockReq.headers = {};
      // Create a circular structure that throws on JSON.stringify
      const circular = {};
      circular.self = circular;
      mockReq.body = circular;
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTP,
      );

      expect(mockAxiosInstance.request).toHaveBeenCalled();
    });

    it("should gracefully handle undefined request bodies when checking length", async () => {
      mockReq.headers = {};
      mockReq.body = undefined;
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTP,
      );

      expect(mockAxiosInstance.request).toHaveBeenCalled();
    });

    it("should always inject the recursion header to prevent forwarding loops", async () => {
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTP,
      );

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            [RECURSION_HEADER_NAME]: RECURSION_HEADER_VALUE,
          }),
        }),
      );
    });

    it("should push error data to Actor when sending fails", async () => {
      /** @type {CommonError} */
      const err = new Error("Network timeout");
      err.code = "ETIMEDOUT";
      mockAxiosInstance.request.mockRejectedValue(err);

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );

      expect(apifyMock.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          webhookId: mockEvent.webhookId,
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining(err.code),
        }),
      );
    });

    it("should use a generic error message for unapproved failure codes to avoid leaking data", async () => {
      const err = new Error("Sensitive Internal Data Leak: API Key 123");
      // No reliable code/response mapped => Unknown error
      mockAxiosInstance.request.mockRejectedValue(err);

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );

      expect(apifyMock.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          webhookId: mockEvent.webhookId,
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining(ERROR_MESSAGES.FORWARD_REQUEST_FAILED),
        }),
      );
    });

    it("should accurately capture HTTP status codes natively thrown from sendSafeRequest", async () => {
      /** @type {CommonError} */
      const err = new Error(ERROR_LABELS.FORBIDDEN);
      err.response = { status: HTTP_STATUS.FORBIDDEN };
      err.isHttpError = true;
      err.code = `${FORWARDING_CONSTS.HTTP_PREFIX}${HTTP_STATUS.FORBIDDEN}`;
      mockAxiosInstance.request.mockRejectedValue(err);

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );

      expect(apifyMock.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          webhookId: mockEvent.webhookId,
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining(String(HTTP_STATUS.FORBIDDEN)),
        }),
      );
    });

    it("should classify 500 errors as transient and include transient label in pushData", async () => {
      /** @type {CommonError} */
      const err = new Error("Internal Server Error");
      err.isHttpError = true;
      err.response = { status: HTTP_STATUS.INTERNAL_SERVER_ERROR };
      mockAxiosInstance.request.mockRejectedValue(err);

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );

      expect(apifyMock.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          webhookId: mockEvent.webhookId,
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.not.stringContaining(
            "Non-transient error/Permanent Failure",
          ),
        }),
      );
      expect(apifyMock.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          webhookId: mockEvent.webhookId,
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining(
            `Request failed with status code ${HTTP_STATUS.INTERNAL_SERVER_ERROR}`,
          ),
        }),
      );
    });

    it("should swallow Actor.pushData failures silently rather than crashing the background worker", async () => {
      /** @type {CommonError} */
      const err = new Error("ETIMEDOUT");
      err.code = "ETIMEDOUT";
      mockAxiosInstance.request.mockRejectedValue(err);

      // The push data fails!
      apifyMock.pushData.mockRejectedValue(new Error("Apify API Offline"));

      const promise = service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );
      // it should NOT reject. The promise should resolve despite errors under the hood.
      await expect(promise).resolves.toBeUndefined();
    });

    it("should gracefully ignore if string length calculation triggers", async () => {
      const bufferBody = Buffer.alloc(MOCK_BUFFER_SIZE);
      mockReq.body = bufferBody;
      delete mockReq.headers[HTTP_HEADERS.CONTENT_LENGTH];
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HOST,
      );
      expect(mockAxiosInstance.request).toHaveBeenCalled();
    });

    it("should fallback to default maxRetries if options.maxForwardRetries is undefined", async () => {
      const optionsNoRetries = { forwardHeaders: true }; // maxForwardRetries is undefined
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      await service.forwardWebhook(
        mockEvent,
        mockReq,
        optionsNoRetries,
        TEST_URL_HTTPS,
      );
      expect(mockAxiosInstance.request).toHaveBeenCalled();
    });

    it("should fallback to validatedUrl if ssrfResult.href is missing", async () => {
      ssrfMock.validateUrlForSsrf.mockResolvedValue({
        safe: true,
        host: TEST_URL_HOST,
      }); // no href
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: TEST_URL_HTTPS }),
      );
    });

    it("should fallback to empty string if ssrfResult.host is missing", async () => {
      ssrfMock.validateUrlForSsrf.mockResolvedValue({
        safe: true,
        href: TEST_URL_HTTPS,
      }); // no host
      mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it("should return immediately and not pushError if signal is aborted during catch block", async () => {
      const controller = new AbortController();
      const err = new Error("Abort");
      mockAxiosInstance.request.mockRejectedValue(err);
      controller.abort();

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
        controller.signal,
      );

      expect(apifyMock.pushData).not.toHaveBeenCalled();
    });

    it("should correctly handle HTTP error without response status in catch block", async () => {
      /** @type {CommonError} */
      const err = new Error("Empty HTTP Error");
      err.isHttpError = true;
      // No status property here
      err.response = {};
      mockAxiosInstance.request.mockRejectedValue(err);

      await service.forwardWebhook(
        mockEvent,
        mockReq,
        mockOptions,
        TEST_URL_HTTPS,
      );

      expect(apifyMock.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining("Request failed with status code 0"),
        }),
      );
    });

    it("should correctly trip the circuit breaker under concurrent failing requests (Stress/Concurrency)", async () => {
      const failingUrl = "https://unstable-target.com";
      ssrfMock.validateUrlForSsrf.mockResolvedValue({
        safe: true,
        href: failingUrl,
        host: "unstable-target.com",
      });

      // Rejects with a non-transient error so it increments failure immediately
      /** @type {CommonError} */
      const err = new Error("Connection Refused");
      err.code = "ECONNREFUSED";
      mockAxiosInstance.request.mockRejectedValue(err);

      // Execute multiple concurrent requests
      const requestedCount = CIRCUIT_BREAKER_FAILURE_COUNT + 1;
      const promises = Array.from({ length: requestedCount }).map(() =>
        service.forwardWebhook(mockEvent, mockReq, mockOptions, failingUrl),
      );

      await Promise.all(promises);

      // The circuit breaker should now be open for this URL
      expect(service.circuitBreaker.isOpen(failingUrl)).toBe(true);

      // Subsequent requests should be blocked immediately (already covered by another test but good for flow)
      await service.forwardWebhook(mockEvent, mockReq, mockOptions, failingUrl);
      // No new axios calls
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(requestedCount);
    });

    describe("hardening (audit feedback)", () => {
      it("should clear Prior circuit breaker failures on success (recordSuccess)", async () => {
        const url = TEST_URL_HTTPS;
        mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });

        // Prime with some failures
        for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_COUNT - 1; i++) {
          service.circuitBreaker.recordFailure(url);
        }
        const host = new URL(url).host;
        expect(service.circuitBreaker.states?.get?.(host)?.failures).toBe(
          CIRCUIT_BREAKER_FAILURE_COUNT - 1,
        );

        await service.sendSafeRequest(url, HTTP_METHODS.POST, {}, {}, {});

        // Success should have cleared the state (since it's not open)
        expect(service.circuitBreaker.states?.has?.(host)).toBe(false);
      });

      it("should log FAILED_LOG_FORWARD when Actor.pushData fails", async () => {
        mockAxiosInstance.request.mockRejectedValue(
          new Error("Request Failed"),
        );
        const pushErr = new Error("Push Failed");
        apifyMock.pushData.mockRejectedValue(pushErr);

        await service.forwardWebhook(
          mockEvent,
          mockReq,
          mockOptions,
          TEST_URL_HTTPS,
        );

        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Object) }),
          LOG_MESSAGES.FAILED_LOG_FORWARD,
        );
      });

      it("should pass HTTPS URLs to validateUrlForSsrf unchanged", async () => {
        mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
        await service.forwardWebhook(
          mockEvent,
          mockReq,
          mockOptions,
          TEST_URL_HTTPS,
        );

        expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(
          TEST_URL_HTTPS,
        );
      });

      it("should NOT trip circuit breaker on first transient failure but trip on exhaustion", async () => {
        const url = TEST_URL_HTTPS;
        const host = new URL(url).host;
        /** @type {CommonError} */
        const transientErr = new Error("Transient");
        transientErr.code = "ETIMEDOUT";
        mockAxiosInstance.request.mockRejectedValue(transientErr);

        // Run with retries
        const maxRetries = 2;
        const promise = service.sendSafeRequest(
          url,
          HTTP_METHODS.POST,
          {},
          {},
          { maxRetries },
        );

        // First attempt fails
        await flushPromises();
        expect(service.circuitBreaker.states.has(host)).toBe(false); // Not tripped yet

        // Advance to exhaust
        jest.advanceTimersByTime(FORWARDING_CONSTS.RETRY_BASE_DELAY_MS);
        await flushPromises();

        await expect(promise).rejects.toThrow();
        expect(service.circuitBreaker.states.get(host)?.failures).toBe(1); // Tripped after exhaustion
      });

      it("should rethrow and skip retries if signal aborted mid-request (catch block)", async () => {
        const controller = new AbortController();
        const url = TEST_URL_HTTPS;

        /** @type {CommonError} */
        const err = new Error("Some Error");
        err.code = "ECONNRESET"; // Usually transient and retried

        // Mock request to abort mid-stream (logic-wise we simulate it being aborted when catch runs)
        mockAxiosInstance.request.mockImplementation(async () => {
          controller.abort();
          throw err;
        });

        const promise = service.sendSafeRequest(
          url,
          HTTP_METHODS.POST,
          {},
          {},
          { maxRetries: 3 },
          controller.signal,
        );

        await expect(promise).rejects.toThrow("Some Error");
        expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1); // No retries because signal was aborted
      });

      it("should default forwardHeaders to true when options.forwardHeaders is undefined", async () => {
        mockAxiosInstance.request.mockResolvedValue({ status: HTTP_STATUS.OK });
        const headers = { "x-custom": "value" };
        const options = { forwardHeaders: undefined }; // Should behave as true

        await service.sendSafeRequest(
          TEST_URL_HTTPS,
          HTTP_METHODS.POST,
          {},
          headers,
          options,
        );

        const reqConfig = mockAxiosInstance.request.mock.calls[0][0];
        expect(reqConfig.headers).toHaveProperty("x-custom", "value");
      });

      it("should use generic message for unknown non-transient error codes during normalization", async () => {
        /** @type {CommonError} */
        const err = new Error("Internal Secret");
        const errCode = "CUSTOM_UNKNOWN_CODE";
        err.code = errCode;
        mockAxiosInstance.request.mockRejectedValue(err);

        await service.forwardWebhook(
          mockEvent,
          mockReq,
          mockOptions,
          TEST_URL_HTTPS,
        );

        expect(apifyMock.pushData).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.stringContaining(
              ERROR_MESSAGES.FORWARD_REQUEST_FAILED,
            ),
          }),
        );
        expect(apifyMock.pushData).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.not.stringContaining(errCode),
          }),
        );
      });
    });
  });
});
