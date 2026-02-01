import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import {
  assertType,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";

// Mock duckdb dependency
jest.unstable_mockModule("../../src/db/duckdb.js", () => ({
  getDbInstance: jest.fn(),
}));

// Dynamic imports after mocking
const { createHealthRoutes } = await import("../../src/routes/health.js");
const { getDbInstance } = await import("../../src/db/duckdb.js");

describe("Health Routes Unit Tests", () => {
  /** @type {number} */
  const webhookCount = 5;
  /** @type {jest.MockedFunction<() => Promise<number>>} */
  let getActiveWebhookCount;
  /** @type {{ready: Function, health: Function}} */
  let routes;

  beforeEach(() => {
    getActiveWebhookCount = assertType(jest.fn().mockReturnValue(webhookCount));
    routes = createHealthRoutes(assertType(getActiveWebhookCount));
    jest.mocked(getDbInstance).mockReset();
    jest.mocked(getDbInstance).mockResolvedValue(assertType({}));
  });

  describe("GET /health", () => {
    test("should return healthy status with memory metrics", async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.health(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "healthy",
          uptime: expect.any(Number),
          memory: expect.any(Object),
        }),
      );
    });
  });

  describe("GET /ready", () => {
    test("should return 200 ready when DB and Webhooks are OK", async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "ready",
          checks: expect.objectContaining({
            database: { status: "ok" },
            webhooks: {
              status: "ok",
              message: `${webhookCount} active webhook(s)`,
            },
          }),
        }),
      );
    });

    test("should return 503 when DB is missing", async () => {
      jest.mocked(getDbInstance).mockResolvedValue(assertType(null));
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "not_ready",
          checks: expect.objectContaining({
            database: { status: "error", message: "Database not initialized" },
          }),
        }),
      );
    });

    test("should return 503 when DB check throws", async () => {
      jest
        .mocked(getDbInstance)
        .mockRejectedValue(new Error("Connection failed"));
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.objectContaining({
            database: { status: "error", message: "Connection failed" },
          }),
        }),
      );
    });

    test("should return 503 when Webhook count throws", async () => {
      getActiveWebhookCount.mockImplementation(() => {
        throw new Error("Count error");
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.objectContaining({
            webhooks: { status: "error", message: "Count error" },
          }),
        }),
      );
    });
  });
});
