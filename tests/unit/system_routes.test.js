/**
 * @file tests/unit/system_routes.test.js
 * @description Unit tests for the system metrics route handler.
 */

import { jest } from "@jest/globals";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { createSystemMetricsHandler } from "../../src/routes/system.js";

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

    const handler = createSystemMetricsHandler(assertType(mockSyncService));
    const mockReq = createMockRequest();
    const mockRes = createMockResponse();
    const mockNext = createMockNextFunction();

    await handler(mockReq, mockRes, mockNext);

    expect(mockSyncService.getMetrics).toHaveBeenCalledTimes(1);
    expect(mockRes.json).toHaveBeenCalledWith({
      timestamp: expect.any(String),
      sync: mockMetrics,
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
});
