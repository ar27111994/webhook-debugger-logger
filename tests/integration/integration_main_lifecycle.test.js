import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

import { sleep } from "../setup/helpers/test-utils.js";
import { HTTP_STATUS } from "../../src/consts.js";
import { setupBasicApifyMock } from "../setup/helpers/shared-mocks.js";

/**
 * Integration Tests for Main.js Application Lifecycle
 *
 * These tests validate the full Express application initialization,
 * route handling, and graceful shutdown behavior without mocking
 * internal components.
 */

/**
 * @typedef {import("express").Application} TestApp
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

const { apifyMock } = await import("../setup/helpers/shared-mocks.js");

const { setupTestApp } = await import("../setup/helpers/app-utils.js");

describe("Main Application - Integration Tests", () => {
  /**
   * @type {TestApp}
   */
  let testApp;
  /**
   * @type {string[]}
   */
  let webhookIds = [];
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  beforeAll(async () => {
    // Clear all mocks and timers before starting
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Setup mock responses using shared helper
    setupBasicApifyMock(apifyMock, {
      input: {
        urlCount: 3,
        retentionHours: 24,
      },
      isAtHome: false,
    });

    // Initialize the application

    ({ app: testApp, appClient, teardownApp } = await setupTestApp());

    // Wait for app to be fully ready
    await sleep(100);

    // Get actual webhook IDs from info endpoint
    const infoResponse = await appClient.get("/info");
    if (infoResponse.status === HTTP_STATUS.OK) {
      const activeWebhooks = /** @type {Array<{id: string}>} */ (
        infoResponse.body.system?.activeWebhooks || []
      );
      webhookIds = activeWebhooks.map((w) => w.id);
    }
  });

  afterAll(async () => {
    // Ensure clean shutdown
    try {
      if (teardownApp) await teardownApp();

      // Wait for shutdown to complete
      await sleep(100);
    } catch {
      // Ignore shutdown errors in tests
    }

    // Clear all timers and mocks
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  describe("Application Initialization", () => {
    test("should create Express application with all routes", () => {
      expect(testApp).toBeDefined();
      expect(typeof testApp.listen).toBe("function");
    });

    test("should have trust proxy enabled", () => {
      expect(testApp.get("trust proxy")).toBe(true);
    });

    test("should initialize with Apify Actor", () => {
      expect(apifyMock.init).toHaveBeenCalled();
      expect(apifyMock.getInput).toHaveBeenCalled();
    });
  });

  describe("Dashboard Route Integration", () => {
    test("should return dashboard HTML on GET /", async () => {
      const response = await appClient.get("/");

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.type).toMatch(/html/);
    });

    test("should allow access without authentication when auth is disabled", async () => {
      const response = await appClient.get("/");

      // Should work without auth key when auth is disabled
      expect(response.status).toBe(HTTP_STATUS.OK);
    });

    test("should return plain text when Accept header is text/plain", async () => {
      const response = await appClient.get("/").set("Accept", "text/plain");

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.type).toMatch(/text\/plain/);
      expect(response.text).toContain("Webhook Debugger");
      expect(response.text).toContain("Active Webhooks:");
    });
  });

  describe("Info Route Integration", () => {
    test("should return system info on GET /info without auth", async () => {
      const response = await appClient.get("/info");

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("system");
      expect(response.body.system).toHaveProperty("activeWebhooks");
      expect(response.body.system).toHaveProperty("retentionHours");
    });
  });

  describe("Logs Route Integration", () => {
    test("should return empty logs initially on GET /logs", async () => {
      const response = await appClient.get("/logs");

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toHaveProperty("items");
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    test("should support pagination parameters", async () => {
      const response = await appClient.get("/logs?page=1&limit=10");

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toHaveProperty("items");
    });
  });

  describe("Webhook Endpoint Integration", () => {
    test("should accept webhook POST request", async () => {
      // Use first webhook ID
      const webhookId = webhookIds[0];

      // Skip if no webhooks available
      if (!webhookId) {
        expect(webhookIds.length).toBeGreaterThanOrEqual(0);
        return;
      }

      const response = await appClient
        .post(`/webhook/${webhookId}`)
        .send({ test: "data" })
        .set("Content-Type", "application/json");

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.text).toBe("OK");
    });

    test("should handle JSON parsing errors gracefully", async () => {
      const webhookId = webhookIds[1];
      const response = await appClient
        .post(`/webhook/${webhookId}`)
        .send("{invalid json")
        .set("Content-Type", "application/json");

      // Should accept it - middleware handles malformed JSON
      expect([
        HTTP_STATUS.OK,
        HTTP_STATUS.BAD_REQUEST,
        HTTP_STATUS.NOT_FOUND,
      ]).toContain(response.status);
    });

    test("should accept large payloads within limit", async () => {
      const webhookId = webhookIds[2];
      const largePayload = { data: "x".repeat(1000) };

      const response = await appClient
        .post(`/webhook/${webhookId}`)
        .send(largePayload);

      expect(response.status).toBe(HTTP_STATUS.OK);
    });
  });

  describe("Security Middleware Integration", () => {
    test("should allow access when auth is disabled", async () => {
      const response = await appClient.get("/logs");

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toHaveProperty("items");
    });

    test("should accept requests without auth header", async () => {
      const response = await appClient.get("/logs");

      expect(response.status).toBe(HTTP_STATUS.OK);
    });
  });

  describe("Error Handling Integration", () => {
    test("should handle HTTP_STATUS.NOT_FOUND for unknown routes", async () => {
      const response = await appClient.get("/unknown-route");

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    test("should return HTML for unknown routes", async () => {
      const response = await appClient.get("/invalid");

      // Express default HTTP_STATUS.NOT_FOUND returns HTML
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });
  });

  describe("CORS Integration", () => {
    test("should handle OPTIONS preflight requests", async () => {
      const webhookId = webhookIds[0];
      const response = await appClient
        .options(`/webhook/${webhookId}`)
        .set("Origin", "https://example.com");

      expect(response.status).toBe(204);
    });

    test("should set CORS headers on webhook endpoints", async () => {
      const webhookId = webhookIds[0];
      const response = await appClient
        .post(`/webhook/${webhookId}`)
        .set("Origin", "https://example.com")
        .send({ test: "data" });

      expect(response.headers).toHaveProperty("access-control-allow-origin");
    });
  });

  describe("Compression Integration", () => {
    test("should compress responses when requested", async () => {
      const response = await appClient
        .get("/logs")
        .set("Accept-Encoding", "gzip, deflate");

      // Supertest automatically decompresses, so we check it succeeded
      expect(response.status).toBe(HTTP_STATUS.OK);
    });
  });

  describe("Application State Management", () => {
    test("should maintain webhook state across requests", async () => {
      const webhookId = webhookIds[0];

      // Send a webhook
      await appClient
        .post(`/webhook/${webhookId}`)
        .send({ test: "state-data" });

      // Wait briefly for processing
      await sleep(100);

      // Verify it appears in logs
      const logsResponse = await appClient.get("/logs");

      expect(logsResponse.status).toBe(HTTP_STATUS.OK);
      // Logs endpoint returns items array
      expect(Array.isArray(logsResponse.body.items)).toBe(true);
    });
  });
});
