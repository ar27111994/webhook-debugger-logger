import { jest, describe, test, expect } from "@jest/globals";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType, createMockRequest } from "../setup/helpers/test-utils.js";

// 1. Setup Common Mocks
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, ssrf: true });
import { apifyMock, axiosMock } from "../setup/helpers/shared-mocks.js";

const mockActor = apifyMock;
const mockAxios = axiosMock;

/**
 * @typedef {import('../../src/services/ForwardingService.js').ForwardingService} ForwardingServiceType
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 */

// Mock CONSTS
jest.unstable_mockModule("../../src/consts.js", () => ({
  FORWARD_HEADERS_TO_IGNORE: [],
  FORWARD_TIMEOUT_MS: 100,
  DEFAULT_FORWARD_RETRIES: 3,
  MAX_SAFE_FORWARD_RETRIES: 10,
  TRANSIENT_ERROR_CODES: ["ECONNABORTED", "ETIMEDOUT", "ENETUNREACH"],
}));

// Import class under test
const { ForwardingService } =
  await import("../../src/services/ForwardingService.js");

describe("ForwardingService Tests", () => {
  /** @type {ForwardingServiceType} */
  let forwardingService;

  useMockCleanup(() => {
    forwardingService = new ForwardingService();
  });

  describe("Forwarding Retries & Failures", () => {
    test("should stop retrying on non-transient errors (404)", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

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

      consoleErrorSpy.mockRestore();
    });

    test("should exhaust retries on transient errors", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

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

      consoleErrorSpy.mockRestore();
    });

    test("should respect custom maxForwardRetries", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

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

      consoleErrorSpy.mockRestore();
    });
  });
});
