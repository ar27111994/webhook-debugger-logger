import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import {
  assertType,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";
import { constsMock } from "../setup/helpers/shared-mocks.js";
import { STATUS_LABELS } from "../../src/consts/ui.js";
import { ERROR_MESSAGES } from "../../src/consts/errors.js";

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
          status: STATUS_LABELS.HEALTHY,
          uptime: expect.any(Number),
          memory: expect.any(Object),
        }),
      );
    });
  });

  describe("GET /ready", () => {
    test(`should return ${constsMock.HTTP_STATUS.OK} ready when DB and Webhooks are OK`, async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.OK);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.READY,
          checks: expect.objectContaining({
            database: { status: STATUS_LABELS.OK },
            webhooks: {
              status: STATUS_LABELS.OK,
              message: `${webhookCount} active webhook(s)`,
            },
          }),
        }),
      );
    });

    test(`should return ${constsMock.HTTP_STATUS.SERVICE_UNAVAILABLE} when DB is missing`, async () => {
      jest.mocked(getDbInstance).mockResolvedValue(assertType(null));
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.NOT_READY,
          checks: expect.objectContaining({
            database: {
              status: STATUS_LABELS.ERROR,
              message: ERROR_MESSAGES.DB_NOT_INITIALIZED,
            },
          }),
        }),
      );
    });

    test("should return HTTP_STATUS.SERVICE_UNAVAILABLE when DB check throws", async () => {
      jest
        .mocked(getDbInstance)
        .mockRejectedValue(new Error("Connection failed"));
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.objectContaining({
            database: {
              status: STATUS_LABELS.ERROR,
              message: "Connection failed",
            },
          }),
        }),
      );
    });

    test("should return HTTP_STATUS.SERVICE_UNAVAILABLE when Webhook count throws", async () => {
      getActiveWebhookCount.mockImplementation(() => {
        throw new Error("Count error");
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.ready(req, res);

      expect(res.status).toHaveBeenCalledWith(
        constsMock.HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.objectContaining({
            webhooks: { status: STATUS_LABELS.ERROR, message: "Count error" },
          }),
        }),
      );
    });
  });
});
