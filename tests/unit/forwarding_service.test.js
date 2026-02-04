import { describe, test, expect, jest } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType, createMockRequest } from "../setup/helpers/test-utils.js";

// 1. Setup Common Mocks (including logger for ForwardingService)
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
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
} from "../setup/helpers/shared-mocks.js";

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
    mockAxios.post.mockResolvedValue({ status: 200 });
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

      expect(mockAxios.post).not.toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Blocked IP" }),
        "SSRF blocked forward URL",
      );
    });

    test("should forward headers but ignore sensitive ones", async () => {
      const request = createMockRequest({
        headers: {
          "content-type": "application/json",
          "x-custom": "value",
          host: "localhost", // Should be ignored
          "content-length": "123", // Should be ignored
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

      expect(mockAxios.post).toHaveBeenCalledWith(
        "http://target.com",
        request.body,
        expect.objectContaining({
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-custom": "value",
            "X-Forwarded-By": "Apify-Webhook-Debugger",
            host: "target.com", // Injected from SSRF result
          }),
        }),
      );

      const headers = assertType(mockAxios.post.mock.calls[0][2]).headers;
      expect(headers).not.toHaveProperty("content-length");
    });

    test("should only send content-type if forwardHeaders is false", async () => {
      const request = createMockRequest({
        headers: {
          "content-type": "application/json",
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

      const headers = assertType(mockAxios.post.mock.calls[0][2]).headers;
      expect(headers).toHaveProperty("content-type", "application/json");
      expect(headers).not.toHaveProperty("x-custom");
    });

    test("should handle ECONNABORTED error logging", async () => {
      /** @type {CommonError} */
      const error = new Error("timeout");
      error.code = "ECONNABORTED";
      mockAxios.post.mockRejectedValue(error);
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
        "Forward attempt timed out",
      );
    });
  });

  describe("Forwarding Retries & Failures", () => {
    test("should stop retrying on non-transient errors (404)", async () => {
      /** @type {CommonError} */
      const error = new Error("Not Found");
      error.code = "E_GENERIC";
      mockAxios.post.mockRejectedValue(error);

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
          type: "forward_error",
          body: expect.stringContaining("Non-transient error"),
        }),
      );
      // Wait for 1 attempt
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
    });

    test("should exhaust retries on transient errors", async () => {
      /** @type {CommonError} */
      const error = new Error("Timeout");
      error.code = "ETIMEDOUT";
      mockAxios.post.mockRejectedValue(error);

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
      expect(mockAxios.post).toHaveBeenCalledTimes(3);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "forward_error",
          body: expect.stringContaining("after 3 attempts"),
        }),
      );
    });

    test("should respect custom maxForwardRetries", async () => {
      /** @type {CommonError} */
      const error = new Error("Timeout");
      error.code = "ETIMEDOUT";
      mockAxios.post.mockRejectedValue(error);

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

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(mockActor.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "forward_error",
          body: expect.stringContaining("after 2 attempts"),
        }),
      );
    });

    test("should log error if Actor.pushData fails", async () => {
      /** @type {CommonError} */
      const error = new Error("Fatal");
      error.code = "FATAL";
      mockAxios.post.mockRejectedValue(error);
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
        "Failed to log forward error",
      );
    });

    test("should handle setTimeout unref branch", async () => {
      /** @type {CommonError} */
      const error = new Error("Retryable");
      error.code = "ENOTFOUND"; // transient
      mockAxios.post
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ status: 200 });

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
