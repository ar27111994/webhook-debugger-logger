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
  };
});

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
  });

  test("should log error when SSRF blocks validation during forwarding", async () => {
    // We need to import the middleware creator to test it in isolation or integration
    const { createLoggerMiddleware } =
      await import("../src/logger_middleware.js");

    // Mock WebhookManager properly
    const wm = /** @type {any} */ ({
      get: jest.fn().mockReturnValue({
        id: "test-wh",
      }),
      // Add missing method called by middleware
      getWebhookData: jest.fn().mockReturnValue({
        forwardUrl: "http://169.254.169.254/meta-data", // Defined in webhook config
      }),
      shouldProcess: jest.fn().mockReturnValue(true),
      updateLastActive: jest.fn(),
      isValid: jest.fn().mockReturnValue(true),
    });

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Note: Middleware uses options from args OR webhook config.
    // The SSRF check happens inside the "forwarding" logic block which requires
    // mergedOptions to have forwardUrl.
    const middleware = createLoggerMiddleware(
      wm,
      {
        forwardUrl: "http://169.254.169.254/meta-data",
      },
      () => {}, // broadcast mock
    );

    const req = {
      body: "test",
      headers: {},
      query: {},
      params: { id: "test-wh" },
      method: "POST",
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[FORWARD-ERROR] SSRF blocked"),
    );
    consoleErrorSpy.mockRestore();
  });
});
