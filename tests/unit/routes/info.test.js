/**
 * @file tests/unit/routes/info.test.js
 * @description Unit tests for the info route handler.
 */

import { jest } from "@jest/globals";
import {
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
} from "../../setup/helpers/test-utils.js";
import { createInfoHandler } from "../../../src/routes/info.js";
import { APP_CONSTS } from "../../../src/consts/app.js";
import { DASHBOARD_CONSTS, UNIT_LABELS } from "../../../src/consts/ui.js";
import { assertType } from "../../setup/helpers/test-utils.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('../../../src/webhook_manager.js').WebhookManager} WebhookManager
 */

describe("Info Route", () => {
  /** @type {Request} */
  let mockReq;
  /** @type {Response} */
  let mockRes;
  /** @type {NextFunction} */
  let mockNext;

  beforeEach(() => {
    mockReq = createMockRequest({
      protocol: "https",
      get: assertType(jest.fn()).mockReturnValue("example.com"),
    });
    mockRes = createMockResponse();
    mockNext = createMockNextFunction();
    jest.clearAllMocks();
  });

  it("should return system metrics and API information correctly", () => {
    const webhookData = [{ id: "wh-1" }, { id: "wh-2" }];
    /** @type {WebhookManager} */
    const mockWebhookManager = assertType({
      getAllActive: jest.fn().mockReturnValue(webhookData),
    });

    const RETENTION_HOURS = 24;
    const ONE_MB_IN_BYTES = 1048576;
    const deps = {
      webhookManager: mockWebhookManager,
      getAuthKey: /** @type {() => string} */ (
        jest.fn().mockReturnValue("secret")
      ),
      getRetentionHours: /** @type {() => number} */ (
        jest.fn().mockReturnValue(RETENTION_HOURS)
      ),
      getMaxPayloadSize: /** @type {() => number | undefined} */ (
        jest.fn().mockReturnValue(ONE_MB_IN_BYTES)
      ),
      version: "3.1.3",
    };

    const handler = createInfoHandler(deps);
    handler(mockReq, mockRes, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith({
      version: "3.1.3",
      status: DASHBOARD_CONSTS.INFO_STATUS,
      system: {
        authActive: true,
        retentionHours: RETENTION_HOURS,
        maxPayloadLimit: `1.0${UNIT_LABELS.MB}`,
        webhookCount: webhookData.length,
        activeWebhooks: webhookData,
      },
      features: DASHBOARD_CONSTS.FEATURES_LIST,
      endpoints: {
        logs: DASHBOARD_CONSTS.ENDPOINTS.LOGS,
        logDetail: DASHBOARD_CONSTS.ENDPOINTS.LOG_DETAIL,
        logPayload: DASHBOARD_CONSTS.ENDPOINTS.LOG_PAYLOAD,
        stream: DASHBOARD_CONSTS.ENDPOINTS.STREAM,
        webhook: DASHBOARD_CONSTS.ENDPOINTS.WEBHOOK,
        replay: DASHBOARD_CONSTS.ENDPOINTS.REPLAY,
        info: DASHBOARD_CONSTS.ENDPOINTS.INFO,
        systemMetrics: DASHBOARD_CONSTS.ENDPOINTS.SYSTEM_METRICS,
        health: DASHBOARD_CONSTS.ENDPOINTS.HEALTH,
        ready: DASHBOARD_CONSTS.ENDPOINTS.READY,
      },
      docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
    });
  });

  it("should handle undefined getMaxPayloadSize returning 0.0MB", () => {
    /** @type {WebhookManager} */
    const mockWebhookManager = assertType({
      getAllActive: jest.fn().mockReturnValue([]),
    });

    const FALLBACK_RETENTION_HOURS = 48;
    const deps = {
      webhookManager: mockWebhookManager,
      getAuthKey: /** @type {() => string} */ (
        jest.fn().mockReturnValue(undefined)
      ), // No auth key
      getRetentionHours: /** @type {() => number} */ (
        jest.fn().mockReturnValue(FALLBACK_RETENTION_HOURS)
      ),
      getMaxPayloadSize: /** @type {() => number | undefined} */ (
        jest.fn().mockReturnValue(undefined)
      ),
      version: "3.0.0",
    };

    const handler = createInfoHandler(deps);
    handler(mockReq, mockRes, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.objectContaining({
          authActive: false,
          maxPayloadLimit: `0.0${UNIT_LABELS.MB}`,
          webhookCount: 0,
        }),
      }),
    );
  });
});
