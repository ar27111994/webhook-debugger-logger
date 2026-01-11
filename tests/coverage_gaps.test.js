// Mock Apify before imports
import { jest } from "@jest/globals";

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

// Mock SSRF utility
jest.unstable_mockModule("../src/utils/ssrf.js", async () => {
  return {
    validateUrlForSsrf: jest.fn(async () => ({
      safe: false,
      error: "Simulated SSRF Block",
    })),
    SSRF_ERRORS: {
      INVALID_URL: "Invalid URL format",
      PROTOCOL_NOT_ALLOWED: "Only http/https URLs are allowed",
      CREDENTIALS_NOT_ALLOWED: "Credentials in URL are not allowed",
      HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname",
      INVALID_IP: "URL resolves to invalid IP address",
      INTERNAL_IP: "URL resolves to internal/reserved IP range",
      VALIDATION_FAILED: "URL validation failed",
    },
    checkIpInRanges: jest.fn(() => false),
  };
});

import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  waitForCondition,
} from "./helpers/test-utils.js";

/** @typedef {import("express").Response} Response */
/** @typedef {import("net").Socket} Socket */
/** @typedef {import("../src/webhook_manager.js").WebhookManager & { get: jest.Mock<any>, shouldProcess: jest.Mock<any>, updateLastActive: jest.Mock<any> }} WebhookManagerMock */

const request = (await import("supertest")).default;
const { app, initialize, shutdown } = await import("../src/main.js");

describe("Coverage Improvement Tests", () => {
  beforeAll(async () => {
    await initialize();
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("should handle invalid JSON body gracefully", async () => {
    // Generate a valid webhook first
    const { webhookManager } = await import("../src/main.js");
    const [id] = await webhookManager.generateWebhooks(1, 1);

    // This triggers the try/catch block in main.js around JSON.parse
    const res = await request(app)
      .post(`/webhook/${id}`)
      .set("Content-Type", "application/json")
      .send("{ invalid json }");

    // It should treat it as raw text if parsing fails
    expect(res.statusCode).toBe(200);

    // Optional: Assert that the raw body was captured
    const { Actor } = await import("apify");
    const lastCall = /** @type {any} */ (Actor.pushData).mock.calls[
      /** @type {any} */ (Actor.pushData).mock.calls.length - 1
    ][0];
    expect(lastCall.body).toBe("{ invalid json }");
  });

  test("should log error when SSRF blocks validation during forwarding", async () => {
    // We need to import the middleware creator to test it in isolation or integration
    const { createLoggerMiddleware } =
      await import("../src/logger_middleware.js");
    const { validateUrlForSsrf } = await import("../src/utils/ssrf.js");

    // Mock WebhookManager properly
    const wm = /** @type {WebhookManagerMock} */ ({
      get: /** @type {jest.Mock<any>} */ (
        jest.fn().mockReturnValue({
          id: "test-wh",
        })
      ),
      // Add missing method called by middleware
      getWebhookData: /** @type {WebhookManagerMock['getWebhookData']} */ (
        jest.fn().mockReturnValue({
          forwardUrl: "http://169.254.169.254/meta-data", // Defined in webhook config
        })
      ),
      shouldProcess: jest.fn().mockReturnValue(true),
      updateLastActive: jest.fn(),
      isValid: /** @type {WebhookManagerMock['isValid']} */ (
        jest.fn().mockReturnValue(true)
      ),
    });

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const mw = createLoggerMiddleware(
      wm,
      {
        forwardUrl: "http://169.254.169.254/meta-data",
      },
      () => {}, // broadcast mock
    );

    const req = createMockRequest({
      body: "test",
      headers: {},
      query: {},
      params: { id: "test-wh" },
      method: "POST",
      ip: "127.0.0.1",
      socket: /** @type {Socket} */ ({ remoteAddress: "127.0.0.1" }),
    });
    const res = createMockResponse(
      /** @type {Partial<Response>} */ ({
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
        send: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
      }),
    );
    const next = createMockNextFunction();

    mw(req, res, next);

    // Wait for async processing to log the error
    await waitForCondition(
      () => consoleErrorSpy.mock.calls.length > 0,
      1000,
      10,
    );

    // Verify SSRF validation was called with the blocked URL
    expect(validateUrlForSsrf).toHaveBeenCalledWith(
      "http://169.254.169.254/meta-data",
    );

    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
