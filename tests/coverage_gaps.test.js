// Mock Apify before imports
import { jest } from "@jest/globals";

/** @typedef {import("http").ServerResponse} ServerResponse */
/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */
/** @typedef {import("express").NextFunction} NextFunction */
/** @typedef {import("net").Socket} Socket */
/** @typedef {import("../src/webhook_manager.js").WebhookManager & { get: jest.Mock<any>, shouldProcess: jest.Mock<any>, updateLastActive: jest.Mock<any> }} WebhookManagerMock */

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

// Mock compression to ensure res.write spy works
jest.unstable_mockModule("compression", () => ({
  default:
    () =>
    (
      /** @type {Request} */ _req,
      /** @type {ServerResponse} */ _res,
      /** @type {NextFunction} */ next
    ) =>
      next(),
}));

import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  waitForCondition,
} from "./helpers/test-utils.js";

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
    const { createLoggerMiddleware } = await import(
      "../src/logger_middleware.js"
    );
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
      () => {} // broadcast mock
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
      })
    );
    const next = createMockNextFunction();

    mw(req, res, next);

    // Wait for async processing to log the error
    await waitForCondition(
      () => consoleErrorSpy.mock.calls.length > 0,
      1000,
      10
    );

    // Verify SSRF validation was called with the blocked URL
    expect(validateUrlForSsrf).toHaveBeenCalledWith(
      "http://169.254.169.254/meta-data"
    );

    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  test("should handle SSE initial write failure", async () => {
    const http = await import("http");
    const originalWrite = http.ServerResponse.prototype.write;

    // Spy on write to throw when connection message is sent
    const writeSpy = jest
      .spyOn(http.ServerResponse.prototype, "write")
      .mockImplementation(
        /** @this {import("http").ServerResponse} */ function (chunk, ...args) {
          if (typeof chunk === "string" && chunk.includes(": connected")) {
            throw new Error("Simulated Write Error");
          }
          return originalWrite.apply(/** @type {ServerResponse} */ (this), [
            chunk,
            ...args,
          ]);
        }
      );

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Trigger the SSE endpoint
    // It will hang because it's an open stream, so we race it with a timeout
    try {
      await request(app)
        .get("/log-stream")
        .set("Authorization", "Bearer test-secret")
        .timeout(500);
    } catch (_e) {
      // Expected timeout or connection close
    }

    // Wait a bit for async logs
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SSE-ERROR]"),
      expect.stringContaining("Simulated Write Error")
    );

    writeSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("should log 500 errors in global error handler", async () => {
    const { webhookManager } = await import("../src/main.js");

    // Generate a valid ID first (pass retention hours)
    const [id] = await webhookManager.generateWebhooks(1, 24);

    // Mock webhookManager.isValid to throw a generic error
    const isValidSpy = jest
      .spyOn(webhookManager, "isValid")
      .mockImplementation(() => {
        throw new Error("Simulated Server Crash");
      });

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await request(app).post(`/webhook/${id}`);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Internal Server Error");
    expect(res.body.message).toBe("Internal Server Error");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[SERVER-ERROR]",
      expect.stringContaining("Simulated Server Crash")
    );

    isValidSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("should handle SSE broadcast write failure", async () => {
    const http = await import("http");
    const originalWrite = http.ServerResponse.prototype.write;
    const { webhookManager } = await import("../src/main.js");

    // Spy on write to throw ONLY when broadcasting data
    const writeSpy = jest
      .spyOn(http.ServerResponse.prototype, "write")
      .mockImplementation(
        /** @this {import("http").ServerResponse} */ function (chunk, ...args) {
          const str = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
          if (typeof str === "string" && str.startsWith("data:")) {
            throw new Error("Simulated Broadcast Error");
          }
          return originalWrite.apply(/** @type {ServerResponse} */ (this), [
            chunk,
            ...args,
          ]);
        }
      );

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // 1. Establish SSE Connection
    const sseReq = request(app)
      .get("/log-stream")
      .set("Authorization", "Bearer test-secret")
      .timeout(2000); // Keep alive long enough to receive broadcast

    // Start the request but don't await it yet (it hangs)
    const ssePromise = sseReq.catch((_e) => {
      /* ignore timeout */
    });

    // Wait for connection to be established
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 2. Trigger a Webhook Event (which should broadcast)
    const [id] = await webhookManager.generateWebhooks(1, 24);
    await request(app)
      .post(`/webhook/${id}`)
      .send({ test: "data" })
      .expect(200);

    // Wait for async broadcast (increased timeout)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. Verify Error Log
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[SSE-ERROR] Failed to broadcast message to client:",
      expect.objectContaining({ message: "Simulated Broadcast Error" })
    );

    writeSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    // Ensure SSE request is cleaned up
    sseReq.abort();
    await ssePromise;
  });
});
