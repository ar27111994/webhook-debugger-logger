// Mock Apify before imports
import { jest } from "@jest/globals";

/**
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("net").Socket} Socket
 * @typedef {import("../../src/webhook_manager.js").WebhookManager} WebhookManager
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true, ssrf: true });
import { ssrfMock } from "../setup/helpers/shared-mocks.js";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";
import { waitForCondition, assertType } from "../setup/helpers/test-utils.js";

// Mock compression to ensure res.write spy works
jest.unstable_mockModule("compression", () => ({
  default:
    () =>
    (
      /** @type {Request} */ _req,
      /** @type {ServerResponse} */ _res,
      /** @type {NextFunction} */ next,
    ) =>
      next(),
}));

const { setupTestApp } = await import("../setup/helpers/app-utils.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../setup/helpers/app-utils.js").App} App
 */

describe("Coverage Improvement Tests", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {App} */
  let _app;

  beforeAll(async () => {
    ({ app: _app, appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should handle invalid JSON body gracefully", async () => {
    // Generate a valid webhook first
    const { webhookManager } = await import("../../src/main.js");
    const [id] = await webhookManager.generateWebhooks(1, 1);

    // This triggers the try/catch block in main.js around JSON.parse
    const res = await appClient
      .post(`/webhook/${id}`)
      .set("Content-Type", "application/json")
      .send("{ invalid json }");

    // It should treat it as raw text if parsing fails
    expect(res.statusCode).toBe(200);

    // Optional: Assert that the raw body was captured
    const { Actor } = await import("apify");
    const lastCall = assertType(Actor.pushData).mock.calls[
      assertType(Actor.pushData).mock.calls.length - 1
    ][0];
    expect(lastCall.body).toBe("{ invalid json }");
  });

  test("should log error when SSRF blocks validation during forwarding", async () => {
    // Override generic safe response with a block for this test
    const { validateUrlForSsrf } = await import("../../src/utils/ssrf.js");

    ssrfMock.validateUrlForSsrf.mockResolvedValueOnce({
      safe: false,
      error: "Simulated SSRF Block",
    });

    const forwardUrl = "http://169.254.169.254/meta-data";
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const ctx = await createMiddlewareTestContext({
      options: { forwardUrl },
      request: {
        body: "test",
        headers: {},
        query: {},
        params: { id: "test-wh" },
        method: "POST",
        ip: "127.0.0.1",
        socket: /** @type {Socket} */ ({ remoteAddress: "127.0.0.1" }),
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

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

  test("should handle SSE initial write failure", async () => {
    const http = await import("http");
    const originalWrite = http.ServerResponse.prototype.write;

    // Spy on write to throw when connection message is sent
    const writeSpy = jest
      .spyOn(http.ServerResponse.prototype, "write")
      .mockImplementation(
        /** @this {ServerResponse} */ function (chunk, ...args) {
          if (typeof chunk === "string" && chunk.includes(": connected")) {
            throw new Error("Simulated Write Error");
          }
          return originalWrite.apply(/** @type {ServerResponse} */ (this), [
            chunk,
            ...args,
          ]);
        },
      );

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Trigger the SSE endpoint
    // It will hang because it's an open stream, so we race it with a timeout
    // We expect the request to fail (either via timeout or connection reset)
    await expect(
      appClient
        .get("/log-stream")
        .set("Authorization", "Bearer test-secret")
        .timeout(500),
    ).rejects.toThrow();

    try {
      // Wait a bit for async logs
      await waitForCondition(
        () => consoleErrorSpy.mock.calls.length > 0,
        500,
        10,
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SSE-ERROR]"),
        expect.stringContaining("Simulated Write Error"),
      );
    } finally {
      writeSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  test("should log 500 errors in global error handler", async () => {
    const { webhookManager } = await import("../../src/main.js");

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

    const res = await appClient.post(`/webhook/${id}`);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Internal Server Error");
    expect(res.body.message).toBe("Internal Server Error");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[SERVER-ERROR]",
      expect.stringContaining("Simulated Server Crash"),
    );

    isValidSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("should handle SSE broadcast write failure", async () => {
    const http = await import("http");
    const originalWrite = http.ServerResponse.prototype.write;
    const { webhookManager } = await import("../../src/main.js");

    // Spy on write to throw ONLY when broadcasting data
    const writeSpy = jest
      .spyOn(http.ServerResponse.prototype, "write")
      .mockImplementation(
        /** @this {ServerResponse} */ function (chunk, ...args) {
          const str = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
          if (typeof str === "string" && str.startsWith("data:")) {
            throw new Error("Simulated Broadcast Error");
          }
          return originalWrite.apply(/** @type {ServerResponse} */ (this), [
            chunk,
            ...args,
          ]);
        },
      );

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // 1. Establish SSE Connection
    const sseReq = appClient
      .get("/log-stream")
      .set("Authorization", "Bearer test-secret")
      .timeout(2000); // Keep alive long enough to receive broadcast

    // Start the request but don't await it yet (it hangs)
    const ssePromise = sseReq.catch((_e) => {
      /* ignore timeout */
    });

    try {
      // Wait for connection to be established (polling instead of hard wait)
      await waitForCondition(
        () =>
          writeSpy.mock.calls.some((call) => {
            const chunk = call[0];
            const str = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
            return typeof str === "string" && str.includes(": connected");
          }),
        1000,
        50,
      );

      // 2. Trigger a Webhook Event (which should broadcast)
      const [id] = await webhookManager.generateWebhooks(1, 24);
      await appClient.post(`/webhook/${id}`).send({ test: "data" }).expect(200);

      // 3. Verify Error Log
      await waitForCondition(
        () =>
          consoleErrorSpy.mock.calls.some((call) =>
            call[0].includes(
              "[SSE-ERROR] Failed to broadcast message to client:",
            ),
          ),
        1500,
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[SSE-ERROR] Failed to broadcast message to client:",
        expect.stringContaining('"message":"Simulated Broadcast Error"'),
      );
    } finally {
      // Ensure SSE request is cleaned up
      sseReq.abort();
      await ssePromise;

      writeSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
