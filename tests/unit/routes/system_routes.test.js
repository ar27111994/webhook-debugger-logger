/**
 * @file tests/unit/routes/system_routes.test.js
 * @description Unit tests for the system metrics route handler.
 */

import { jest } from "@jest/globals";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../../setup/helpers/test-utils.js";
import { createSystemMetricsHandler } from "../../../src/routes/system.js";
import { LATENCY_BUDGETS } from "../../../src/consts/app.js";

describe("System Routes", () => {
  it("should retrieve sync metrics and return them as JSON with a timestamp", async () => {
    const mockMetrics = {
      totalBatches: 5,
      totalProcessed: 50,
      pendingEvents: 10,
      failures: 0,
      lastSyncTime: "2023-01-01T00:00:00.000Z",
      status: "IDLE",
    };

    const mockSyncService = {
      getMetrics: jest.fn().mockReturnValue(mockMetrics),
    };
    const mockMetricsRepository = {
      getLatencyMetrics: jest.fn(async () => ({
        total: 3,
        avgAckMs: 12,
        maxAckMs: 20,
        avgScriptMs: 4,
        maxScriptMs: 9,
        avgBackgroundTotalMs: 30,
        maxBackgroundTotalMs: 45,
        asyncEnrichmentCount: 2,
        scriptDemotionCount: 1,
      })),
    };

    const handler = createSystemMetricsHandler(
      assertType(mockSyncService),
      assertType(mockMetricsRepository),
    );
    const mockReq = createMockRequest();
    const mockRes = createMockResponse();
    const mockNext = createMockNextFunction();

    await handler(mockReq, mockRes, mockNext);

    expect(mockSyncService.getMetrics).toHaveBeenCalledTimes(1);
    expect(mockMetricsRepository.getLatencyMetrics).toHaveBeenCalledTimes(1);
    expect(mockRes.json).toHaveBeenCalledWith({
      timestamp: expect.any(String),
      sync: mockMetrics,
      latency: expect.objectContaining({
        total: 3,
        avgScriptMs: 4,
        scriptDemotionCount: 1,
      }),
      latencyBudgets: LATENCY_BUDGETS,
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should propagate errors from getMetrics to error handling middleware", async () => {
    const testError = new Error("Metrics unavailable");
    const mockSyncService = {
      getMetrics: jest.fn().mockImplementation(() => {
        throw testError;
      }),
    };

    const handler = createSystemMetricsHandler(assertType(mockSyncService));
    const mockReq = createMockRequest();
    const mockRes = createMockResponse();
    const mockNext = createMockNextFunction();

    await handler(mockReq, mockRes, mockNext);

    expect(mockSyncService.getMetrics).toHaveBeenCalledTimes(1);
    expect(mockRes.json).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledWith(testError);
  });

  it("should propagate errors from latency metrics to error handling middleware", async () => {
    const testError = new Error("Latency metrics unavailable");
    const mockSyncService = {
      getMetrics: jest.fn().mockReturnValue({ status: "IDLE" }),
    };
    const mockMetricsRepository = {
      getLatencyMetrics: jest.fn(async () => {
        throw testError;
      }),
    };

    const handler = createSystemMetricsHandler(
      assertType(mockSyncService),
      assertType(mockMetricsRepository),
    );
    const mockReq = createMockRequest();
    const mockRes = createMockResponse();
    const mockNext = createMockNextFunction();

    await handler(mockReq, mockRes, mockNext);

    expect(mockSyncService.getMetrics).toHaveBeenCalledTimes(1);
    expect(mockMetricsRepository.getLatencyMetrics).toHaveBeenCalledTimes(1);
    expect(mockRes.json).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledWith(testError);
  });
});
