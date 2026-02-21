/**
 * @file tests/unit/health.test.js
 * @description Unit tests for health and readiness probes.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  assertType,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";
import { HTTP_STATUS } from "../../src/consts/http.js";
import { STATUS_LABELS, UNIT_LABELS } from "../../src/consts/ui.js";
import { ERROR_MESSAGES } from "../../src/consts/errors.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";

await setupCommonMocks({ logger: true, db: true });
await jest.resetModules();

const { getDbInstance } = await import("../../src/db/duckdb.js");
const { createHealthRoutes } = await import("../../src/routes/health.js");

describe("Health Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("/health (Liveness Probe)", () => {
    it("should return 200 OK with process metrics", async () => {
      /** @type {() => number} */
      const mockGetActiveWebhookCount = assertType(jest.fn());
      const { health } = createHealthRoutes(mockGetActiveWebhookCount);
      const mockReq = createMockRequest();
      const mockRes = createMockResponse();

      await health(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.HEALTHY,
          uptime: expect.any(Number),
          timestamp: expect.any(String),
          memory: expect.objectContaining({
            heapUsed: expect.any(Number),
            heapTotal: expect.any(Number),
            rss: expect.any(Number),
            unit: UNIT_LABELS.MB,
          }),
        }),
      );
    });
  });

  describe("/ready (Readiness Probe)", () => {
    const MOCK_WEBHOOK_COUNT = 5;

    it("should return 200 OK when DB is connected and Webhooks exist", async () => {
      jest
        .mocked(getDbInstance)
        .mockResolvedValueOnce(assertType({ connected: true }));
      const mockGetActiveWebhookCount = jest
        .fn()
        .mockReturnValue(MOCK_WEBHOOK_COUNT);

      const { ready } = createHealthRoutes(
        assertType(mockGetActiveWebhookCount),
      );
      const mockReq = createMockRequest();
      const mockRes = createMockResponse();

      await ready(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.READY,
          checks: {
            database: { status: STATUS_LABELS.OK },
            webhooks: {
              status: STATUS_LABELS.OK,
              message: `${MOCK_WEBHOOK_COUNT} active webhook(s)`,
            },
          },
        }),
      );
    });

    it("should return 503 HTTP_STATUS.SERVICE_UNAVAILABLE when DB is NOT initialized", async () => {
      jest.mocked(getDbInstance).mockResolvedValueOnce(assertType(null));
      const mockGetActiveWebhookCount = jest
        .fn()
        .mockReturnValue(MOCK_WEBHOOK_COUNT);

      const { ready } = createHealthRoutes(
        assertType(mockGetActiveWebhookCount),
      );
      const mockReq = createMockRequest();
      const mockRes = createMockResponse();

      await ready(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(mockRes.json).toHaveBeenCalledWith(
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

    it("should return 503 HTTP_STATUS.SERVICE_UNAVAILABLE when DB promise rejects", async () => {
      const errorMsg = "Database timeout";
      const dbError = new Error(errorMsg);
      jest.mocked(getDbInstance).mockRejectedValueOnce(dbError);
      const mockGetActiveWebhookCount = jest
        .fn()
        .mockReturnValue(MOCK_WEBHOOK_COUNT);

      const { ready } = createHealthRoutes(
        assertType(mockGetActiveWebhookCount),
      );
      const mockReq = createMockRequest();
      const mockRes = createMockResponse();

      await ready(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.NOT_READY,
          checks: expect.objectContaining({
            database: {
              status: STATUS_LABELS.ERROR,
              message: errorMsg,
            },
          }),
        }),
      );
    });

    it("should return 503 HTTP_STATUS.SERVICE_UNAVAILABLE when DB promise rejects with non-Error object", async () => {
      const errorMsg = "String rejection";
      jest.mocked(getDbInstance).mockRejectedValueOnce(errorMsg);
      const mockGetActiveWebhookCount = jest
        .fn()
        .mockReturnValue(MOCK_WEBHOOK_COUNT);

      const { ready } = createHealthRoutes(
        assertType(mockGetActiveWebhookCount),
      );
      const mockReq = createMockRequest();
      const mockRes = createMockResponse();

      await ready(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.NOT_READY,
          checks: expect.objectContaining({
            database: {
              status: STATUS_LABELS.ERROR,
              message: LOG_MESSAGES.UNKNOWN_ERROR,
            },
          }),
        }),
      );
    });

    it("should return 503 HTTP_STATUS.SERVICE_UNAVAILABLE when getActiveWebhookCount throws", async () => {
      jest
        .mocked(getDbInstance)
        .mockResolvedValueOnce(assertType({ connected: true }));
      const errorMsg = "Manager not available";
      const mockGetActiveWebhookCount = jest.fn().mockImplementation(() => {
        throw new Error(errorMsg);
      });

      const { ready } = createHealthRoutes(
        assertType(mockGetActiveWebhookCount),
      );
      const mockReq = createMockRequest();
      const mockRes = createMockResponse();

      await ready(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.NOT_READY,
          checks: expect.objectContaining({
            webhooks: {
              status: STATUS_LABELS.ERROR,
              message: errorMsg,
            },
          }),
        }),
      );
    });

    it("should return 503 HTTP_STATUS.SERVICE_UNAVAILABLE when getActiveWebhookCount throws non-Error", async () => {
      jest
        .mocked(getDbInstance)
        .mockResolvedValueOnce(assertType({ connected: true }));
      const errorMsg = "string error";
      const mockGetActiveWebhookCount = jest.fn().mockImplementation(() => {
        throw errorMsg;
      });

      const { ready } = createHealthRoutes(
        assertType(mockGetActiveWebhookCount),
      );
      const mockReq = createMockRequest();
      const mockRes = createMockResponse();

      await ready(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: STATUS_LABELS.NOT_READY,
          checks: expect.objectContaining({
            webhooks: {
              status: STATUS_LABELS.ERROR,
              message: LOG_MESSAGES.UNKNOWN_ERROR, // from the non instanceof Error catch block
            },
          }),
        }),
      );
    });
  });
});
