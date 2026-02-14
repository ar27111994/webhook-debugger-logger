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
} from "../../src/consts/http.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";
import { ERROR_MESSAGES, ERROR_LABELS } from "../../src/consts/errors.js";
import { FORWARDING_CONSTS } from "../../src/consts/app.js";

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
      href: "http://target.com",
      host: "target.com",
    });
  });

  describe("Forwarding Logic", () => {
    test("should validate URL via SSRF check", async () => {
      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-1", id: "evt-1" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(
        event,
        request,
        {},
        "http://target.com",
      );

      expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(
        "http://target.com",
      );
    });

    test("should normalize URL without protocol", async () => {
      const event = assertType({ webhookId: "fw-1", id: "evt-1" });
      const request = createMockRequest();
      await forwardingService.forwardWebhook(event, request, {}, "target.com");
      expect(ssrfMock.validateUrlForSsrf).toHaveBeenCalledWith(
        "http://target.com",
      );
    });

    test("should abort if SSRF validation fails", async () => {
      ssrfMock.validateUrlForSsrf.mockResolvedValue({
        safe: false,
        error: "Blocked IP",
      });
      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-2", id: "evt-2" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(
        event,
        request,
        {},
        "http://unsafe.com",
      );

      expect(mockAxios).not.toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Blocked IP" }),
        LOG_MESSAGES.SSRF_BLOCKED,
      );
    });

    test("should forward headers but ignore sensitive ones", async () => {
      const request = createMockRequest({
        headers: {
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          "x-custom": "value",
          [HTTP_HEADERS.HOST]: "localhost", // Should be ignored
          [HTTP_HEADERS.CONTENT_LENGTH]: "123", // Should be ignored
        },
        body: { data: 123 },
      });
      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-3", id: "evt-3" });

      await forwardingService.forwardWebhook(
        event,
        request,
        {},
        "http://target.com",
      );

      expect(mockAxios).toHaveBeenCalledWith(
        "http://target.com",
        request.body,
        expect.objectContaining({
          headers: expect.objectContaining({
            [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
            "x-custom": "value",
            [constsMock.RECURSION_HEADER_NAME]:
              constsMock.RECURSION_HEADER_VALUE,
            [HTTP_HEADERS.HOST]: "target.com", // Injected from SSRF result
          }),
        }),
      );

      const headers = assertType(mockAxios.mock.calls[0][0]).headers;
      expect(headers).not.toHaveProperty(HTTP_HEADERS.CONTENT_LENGTH);
    });

    test("should only send content-type if forwardHeaders is false", async () => {
      const request = createMockRequest({
        headers: {
          [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
          "x-custom": "value",
        },
      });
      const event = assertType({ webhookId: "fw-4", id: "evt-4" });

      await forwardingService.forwardWebhook(
        event,
        request,
        { forwardHeaders: false },
        "http://target.com",
      );

      const headers = assertType(mockAxios.mock.calls[0][0]).headers;
      expect(headers).toHaveProperty(
        HTTP_HEADERS.CONTENT_TYPE,
        MIME_TYPES.JSON,
      );
      expect(headers).not.toHaveProperty("x-custom");
    });

    test("should handle ECONNABORTED error logging", async () => {
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
        "http://target.com",
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
      mockAxios.mockRejectedValue(error);

      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-test", id: "evt-1" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(
        event,
        request,
        {},
        "http://target.com",
      );

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

      await forwardingService.forwardWebhook(
        event,
        request,
        {},
        "http://target.com",
      );

      // Default (3)
      expect(mockAxios).toHaveBeenCalledTimes(3);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining("after 3 attempts"),
        }),
      );
    });

    test("should respect custom maxForwardRetries", async () => {
      /** @type {CommonError} */
      const error = new Error("Timeout");
      error.code = "ETIMEDOUT";
      mockAxios.mockRejectedValue(error);

      /** @type {WebhookEvent} */
      const event = assertType({ webhookId: "fw-custom-retry", id: "evt-3" });
      const request = createMockRequest();

      // Override global options for this call
      await forwardingService.forwardWebhook(
        event,
        request,
        { maxForwardRetries: 2 },
        "http://target.com",
      );

      expect(mockAxios).toHaveBeenCalledTimes(2);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ERROR_LABELS.FORWARD_ERROR,
          body: expect.stringContaining("after 2 attempts"),
        }),
      );
    });

    test("should log error if Actor.pushData fails", async () => {
      /** @type {CommonError} */
      const error = new Error("Fatal");
      error.code = "FATAL";
      mockAxios.mockRejectedValue(error);
      mockActor.pushData.mockRejectedValue(new Error("Storage Error"));

      const event = assertType({ webhookId: "fw-fail", id: "evt-6" });
      const request = createMockRequest();

      await forwardingService.forwardWebhook(
        event,
        request,
        { maxForwardRetries: 1 },
        "http://target.com",
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        LOG_MESSAGES.FAILED_LOG_FORWARD,
      );
    });

    test("should handle setTimeout unref branch", async () => {
      /** @type {CommonError} */
      const error = new Error("Retryable");
      error.code = "ENOTFOUND"; // transient
      mockAxios
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ status: HTTP_STATUS.OK });

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
        "http://target.com",
      );

      expect(mockTimer.unref).toHaveBeenCalled();

      global.setTimeout = originalSetTimeout;
    });
  });
});
