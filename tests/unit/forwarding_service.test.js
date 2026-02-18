import { describe, test, expect, jest } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType, createMockRequest } from "../setup/helpers/test-utils.js";

// 1. Setup Common Mocks (including logger for ForwardingService)
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({
  axios: true,
  apify: true,
  ssrf: true,
  logger: true,
  consts: true,
});
import {
  apifyMock,
  axiosMock,
  ssrfMock,
  loggerMock,
  constsMock,
} from "../setup/helpers/shared-mocks.js";
import {
  HTTP_STATUS,
  HTTP_HEADERS,
  MIME_TYPES,
  HTTP_METHODS,
} from "../../src/consts/http.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";
import {
  ERROR_MESSAGES,
  ERROR_LABELS,
  NODE_ERROR_CODES,
} from "../../src/consts/errors.js";
import { FORWARDING_CONSTS, APP_CONSTS } from "../../src/consts/app.js";

const TARGET_DOMAIN = "target.com";
const TARGET_URL = `https://${TARGET_DOMAIN}`;
const UNSAFE_URL = "https://unsafe.com";
const DEFAULT_RETRIES = 3;
const CUSTOM_RETRIES = 2;
const DEFAULT_DELAY = 1000;
const mockActor = apifyMock;
const mockAxios = axiosMock;

/**
 * @typedef {import('../../src/services/ForwardingService.js').ForwardingService} ForwardingServiceType
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 */

// Import class under test
const { ForwardingService } =
  await import("../../src/services/ForwardingService.js");

describe("ForwardingService Tests", () => {
  /** @type {ForwardingServiceType} */
  let forwardingService;

  useMockCleanup(() => {
    forwardingService = new ForwardingService();
    mockAxios.mockResolvedValue({ status: HTTP_STATUS.OK });
    ssrfMock.validateUrlForSsrf.mockResolvedValue({
      safe: true,
      host: TARGET_DOMAIN,
    });
  });

  describe("Forwarding Logic", () => {
    test("should validate URL via SSRF check", async () => {
      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-1", id: "evt-1" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(TARGET_URL);
    });

    test("should normalize URL without protocol", async () => {
      const event = assertType({ webhookId: "fw-1", id: "evt-1" });
      const request = createMockRequest();
      await forwardingService.forwardWebhook(event, request, {}, TARGET_DOMAIN);
      expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(
        `http://${TARGET_DOMAIN}`,
      );
    });

    test("should abort if SSRF validation fails", async () => {
      const error = "Blocked IP";
      ssrfMock.validateUrlForSsrf.mockResolvedValueOnce({
        safe: false,
        error,
      });
      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-2", id: "evt-2" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(event, request, {}, UNSAFE_URL);

      expect(mockAxios).not.toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ error }),
        LOG_MESSAGES.SSRF_BLOCKED,
      );
    });

    test("should forward headers but ignore sensitive ones", async () => {
      const CUSTOM_HEADER_KEY = "x-custom";
      const CUSTOM_HEADER_VALUE = "value";
      const request = createMockRequest({
        headers: {
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          [CUSTOM_HEADER_KEY]: CUSTOM_HEADER_VALUE,
          [HTTP_HEADERS.HOST]: "localhost", // Should be ignored
          [HTTP_HEADERS.CONTENT_LENGTH]: "123", // Should be ignored
        },
        body: { data: 123 },
      });
      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-3", id: "evt-3" });

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: TARGET_URL,
          method: HTTP_METHODS.POST,
          data: request.body,
          headers: expect.objectContaining({
            [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
            [CUSTOM_HEADER_KEY]: CUSTOM_HEADER_VALUE,
            [constsMock.RECURSION_HEADER_NAME]:
              constsMock.RECURSION_HEADER_VALUE,
            // HOST must match TARGET_DOMAIN (injected from SSRF result)
            [HTTP_HEADERS.HOST]: TARGET_DOMAIN,
          }),
        }),
      );

      const headers = assertType(mockAxios.mock.calls[0][0]).headers;
      expect(headers).not.toHaveProperty(HTTP_HEADERS.CONTENT_LENGTH);
    });

    test("should only send content-type if forwardHeaders is false", async () => {
      const CUSTOM_HEADER_KEY = "x-custom";
      const CUSTOM_HEADER_VALUE = "value";
      const request = createMockRequest({
        headers: {
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          [CUSTOM_HEADER_KEY]: CUSTOM_HEADER_VALUE,
        },
      });
      const event = assertType({ webhookId: "fw-4", id: "evt-4" });

      await forwardingService.forwardWebhook(
        event,
        request,
        { forwardHeaders: false },
        TARGET_URL,
      );

      const headers = assertType(mockAxios.mock.calls[0][0]).headers;
      expect(headers).toHaveProperty(
        HTTP_HEADERS.CONTENT_TYPE,
        MIME_TYPES.JSON,
      );
      expect(headers).not.toHaveProperty(CUSTOM_HEADER_KEY);
    });

    test("should handle ECONNABORTED error logging and transient retry", async () => {
      /** @type {CommonError} */
      const error = new Error("timeout");
      error.code = FORWARDING_CONSTS.TIMEOUT_CODE;
      mockAxios.mockRejectedValue(error);
      const event = assertType({ webhookId: "fw-5", id: "evt-5" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(
        event,
        request,
        { maxForwardRetries: 1 },
        TARGET_URL,
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.anything(),
        ERROR_MESSAGES.FORWARD_TIMEOUT,
      );
    });
  });

  describe("Forwarding Retries & Failures", () => {
    test("should stop retrying on non-transient errors (404)", async () => {
      /** @type {CommonError} */
      const error = new Error("Not Found");
      error.code = "E_GENERIC";
      error.response = { status: HTTP_STATUS.NOT_FOUND };
      mockAxios.mockRejectedValue(error);

      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-test", id: "evt-1" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      // Should fail fast and capture error
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining("Non-transient error"),
        }),
      );
      // Wait for 1 attempt
      expect(mockAxios).toHaveBeenCalledTimes(1);
    });

    test("should exhaust retries on transient errors", async () => {
      /** @type {CommonError} */
      const error = new Error("Timeout");
      error.code = "ETIMEDOUT";
      mockAxios.mockRejectedValue(error);

      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-retry-test", id: "evt-2" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      // Default (3)
      expect(mockAxios).toHaveBeenCalledTimes(DEFAULT_RETRIES);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining(`after ${DEFAULT_RETRIES} attempts`),
        }),
      );
    });

    test("should retry on HTTP 500, 502, 503, 504 and exhaust retries", async () => {
      const codes = [
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        HTTP_STATUS.BAD_GATEWAY,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        HTTP_STATUS.GATEWAY_TIMEOUT,
      ];

      for (const code of codes) {
        mockAxios.mockReset();
        mockActor.pushData.mockClear();
        /** @type {CommonError} */
        const error = new Error("Http Error");
        error.code = `HTTP_${code}`;
        error.isHttpError = true;
        error.response = { status: code };
        mockAxios.mockRejectedValue(error);

        const event = assertType({
          webhookId: "fw-http-retry",
          id: "evt-http",
        });
        const request = createMockRequest();

        await forwardingService.forwardWebhook(
          event,
          request,
          { maxForwardRetries: CUSTOM_RETRIES },
          TARGET_URL,
        );

        expect(mockAxios).toHaveBeenCalledTimes(CUSTOM_RETRIES);
        expect(mockActor.pushData).toHaveBeenCalledWith(
          expect.objectContaining({
            type: ERROR_LABELS.FORWARD_ERROR,
            body: expect.stringContaining(`after ${CUSTOM_RETRIES} attempts`),
          }),
        );
      }
    });

    test("should NOT retry on HTTP 400 or other non-transient codes", async () => {
      mockAxios.mockReset();
      // Manual failure simulation for 400
      mockAxios.mockResolvedValue({
        status: HTTP_STATUS.BAD_REQUEST,
        data: "Bad Request",
      });

      const event = assertType({ webhookId: "fw-400", id: "evt-400" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(
        event,
        request,
        { maxForwardRetries: 3 },
        TARGET_URL,
      );

      // Should happen only once because 400 is not transient
      expect(mockAxios).toHaveBeenCalledTimes(1);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("Non-transient error"),
        }),
      );
    });

    test("should sanitise errors in Actor logs (allowed vs disallowed codes)", async () => {
      // 1. Allowed code (e.g. ETIMEDOUT)
      mockAxios.mockRejectedValue({ code: "ETIMEDOUT" });
      await forwardingService.forwardWebhook(
        assertType({ webhookId: "1", id: "1" }),
        createMockRequest(),
        { maxForwardRetries: 1 },
        TARGET_URL,
      );
      expect(mockActor.pushData).toHaveBeenLastCalledWith(
        expect.objectContaining({ body: expect.stringContaining("ETIMEDOUT") }),
      );

      // 2. Disallowed/Unknown code -> Generic message
      mockAxios.mockRejectedValue({ code: "SENSITIVE_DB_ERROR" });
      await forwardingService.forwardWebhook(
        assertType({ webhookId: "2", id: "2" }),
        createMockRequest(),
        { maxForwardRetries: 1 },
        TARGET_URL,
      );
      // Should NOT contain SENSITIVE_DB_ERROR, should use generic error
      const lastCall = mockActor.pushData.mock.lastCall?.[0];
      expect(lastCall).not.toBeUndefined();
      expect(lastCall?.body).not.toContain("SENSITIVE_DB_ERROR");
      expect(lastCall?.body).toContain(ERROR_MESSAGES.FORWARD_REQUEST_FAILED);

      // 3. HTTP Error code allowed
      const error = {
        isHttpError: true,
        code: NODE_ERROR_CODES.ERR_BAD_REQUEST, // "ERR_BAD_REQUEST" is in SAFE_CODES
        response: { status: HTTP_STATUS.BAD_REQUEST },
      };
      mockAxios.mockRejectedValue(error);
      await forwardingService.forwardWebhook(
        assertType({ webhookId: "3", id: "3" }),
        createMockRequest(),
        { maxForwardRetries: 1 },
        TARGET_URL,
      );
      expect(mockActor.pushData).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(NODE_ERROR_CODES.ERR_BAD_REQUEST),
        }),
      );
    });

    test("should handle setTimeout unref branch", async () => {
      /** @type {CommonError} */
      const error = new Error("Retryable");
      error.code = "ENOTFOUND"; // transient
      mockAxios
        .mockRejectedValueOnce(error) // Fail 1st => wait
        .mockResolvedValueOnce({ status: HTTP_STATUS.OK }); // Pass 2nd

      const event = assertType({ webhookId: "fw-ref", id: "evt-7" });
      const request = createMockRequest();

      // Mock setTimeout to check unref
      const mockTimer = { unref: jest.fn() };
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = assertType(
        /**
         * @param {Function} cb
         * @returns {typeof setTimeout}
         */
        (cb) => {
          cb();
          return assertType(mockTimer);
        },
      );

      await forwardingService.forwardWebhook(
        event,
        request,
        { maxForwardRetries: 2 },
        TARGET_URL,
      );

      expect(mockTimer.unref).toHaveBeenCalled();

      global.setTimeout = originalSetTimeout;
    });
  });

  describe("Body Size Calculation Coverage", () => {
    test("should use content-length header if present", async () => {
      const limit = APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE; // Standard limit
      const request = createMockRequest({
        headers: { [HTTP_HEADERS.CONTENT_LENGTH]: String(limit + 1) },
      });
      const event = assertType({ webhookId: "fw-size-1", id: "evt-size-1" });

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      // exceeded limit -> no axios call, warn log
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ size: limit + 1 }),
        LOG_MESSAGES.FORWARD_PAYLOAD_TOO_LARGE,
      );
      expect(mockAxios).not.toHaveBeenCalled();
    });

    test("should calculate Buffer body size exceeding limit", async () => {
      // Use real buffer > MAX_ALLOWED_PAYLOAD_SIZE (10MB)
      const limit = APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE;
      const bufferSize = limit + 1; // 1 byte over
      const body = Buffer.alloc(bufferSize);

      const request = createMockRequest({ body });
      const event = assertType({ webhookId: "fw-size-2", id: "evt-size-2" });

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ size: bufferSize, limit }),
        LOG_MESSAGES.FORWARD_PAYLOAD_TOO_LARGE,
      );
      expect(mockAxios).not.toHaveBeenCalled();
    });

    test("should calculate string body size exceeding limit", async () => {
      const limit = APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE;
      const strSize = limit + 1;
      const body = "a".repeat(strSize);

      const request = createMockRequest({ body });
      const event = assertType({ webhookId: "fw-size-3", id: "evt-size-3" });

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ size: strSize, limit }),
        LOG_MESSAGES.FORWARD_PAYLOAD_TOO_LARGE,
      );
      expect(mockAxios).not.toHaveBeenCalled();
    });

    test("should handle circular JSON objects gracefully (size 0)", async () => {
      const circular = {};
      circular.self = circular;
      const request = createMockRequest({ body: circular }); // Object body, no content-length
      const event = assertType({ webhookId: "fw-circ", id: "evt-circ" });

      // Should default to 0 size and proceed
      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      // Should call axios because size 0 <= limit
      expect(mockAxios).toHaveBeenCalled();
    });
  });

  describe("Abort Signal Handling", () => {
    test("should abort inside retry loop via signal event", async () => {
      // Setup: 1st call fails, then we wait. During wait, signal aborts.
      // We need fake timers to control the delay and trigger abort.
      jest.useFakeTimers();

      /** @type {CommonError} */
      const error = new Error("Retryable");
      error.code = "ETIMEDOUT";
      mockAxios.mockRejectedValue(error); // Always fail

      const controller = new AbortController();
      const event = assertType({ webhookId: "fw-abort-loop", id: "evt-al" });
      const request = createMockRequest();

      const forwardPromise = forwardingService.forwardWebhook(
        event,
        request,
        { maxForwardRetries: CUSTOM_RETRIES },
        TARGET_URL,
        controller.signal,
      );

      // Allow initial request to fire before advancing timers
      await Promise.resolve();
      // Fast-forward time to trigger first retry logic/delay
      jest.advanceTimersByTime(DEFAULT_DELAY);

      // Now we are "waiting". Trigger abort.
      controller.abort();

      // Advancing timers might be needed if the abort listener didn't fire immediately
      jest.runAllTimers();

      // Catch error? forwardWebhook swallows internal abort error but returns undefined.
      await forwardPromise;

      expect(mockAxios).toHaveBeenCalledTimes(1);
    });

    test("should check abort signal before request attempt", async () => {
      const controller = new AbortController();
      controller.abort(); // Pre-aborted

      const event = assertType({ webhookId: "fw-pre-abort", id: "evt-pa" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(
        event,
        request,
        {},
        TARGET_URL,
        controller.signal,
      );

      expect(loggerMock.info).toHaveBeenCalledWith(
        LOG_MESSAGES.FORWARD_ABORTED,
      );
      expect(mockAxios).not.toHaveBeenCalled();
    });
  });

  describe("Coverage Gaps", () => {
    test("should skip forwarding if circuit breaker is open", async () => {
      // Mock circuit breaker state logic
      // Note: spies on methods of 'forwardingService.circuitBreaker' instance
      jest
        .spyOn(forwardingService.circuitBreaker, "isOpen")
        .mockReturnValue(true);

      const event = assertType({ webhookId: "fw-cb", id: "evt-cb" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(event, request, {}, TARGET_URL);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.anything(),
        LOG_MESSAGES.CIRCUIT_BREAKER_OPEN,
      );
      expect(mockAxios).not.toHaveBeenCalled();
    });
  });
});
