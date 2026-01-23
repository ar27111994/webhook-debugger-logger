import { jest } from "@jest/globals";
import { createDashboardHandler } from "../../src/routes/dashboard.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "../setup/helpers/test-utils.js";
import { createMockWebhookManager } from "../setup/helpers/shared-mocks.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import("../../src/webhook_manager.js").WebhookManager} WebhookManager
 * @typedef {import("../../src/routes/dashboard.js").DashboardDependencies} DashboardDependencies
 */

describe("Dashboard Handler - Signature Badge", () => {
  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;
  /** @type {WebhookManager} */
  let mockWebhookManager;
  /** @type {DashboardDependencies} */
  let deps;

  beforeEach(() => {
    req = createMockRequest();
    res = createMockResponse();
    next = createMockNextFunction();
    mockWebhookManager = createMockWebhookManager();
    deps = /** @type {DashboardDependencies} */ ({
      webhookManager: mockWebhookManager,
      version: "1.0.0",
      getTemplate: jest
        .fn()
        .mockReturnValue("<html>{{SIGNATURE_BADGE}}</html>"),
      setTemplate: jest.fn(),
      getSignatureStatus: jest.fn(),
    });
  });

  test("should display active signature badge when enabled", async () => {
    jest.mocked(deps.getSignatureStatus).mockReturnValue("STRIPE");
    const handler = createDashboardHandler(deps);
    await handler(req, res, next);

    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("Verified: STRIPE"),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("signature-active"),
    );
  });

  test("should display inactive signature badge when disabled", async () => {
    jest.mocked(deps.getSignatureStatus).mockReturnValue(null);
    const handler = createDashboardHandler(deps);
    await handler(req, res, next);

    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("No Verification"),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("signature-inactive"),
    );
  });

  test("should return status in text/plain response", async () => {
    req.headers["accept"] = "text/plain";
    jest.mocked(deps.getSignatureStatus).mockReturnValue("SHOPIFY");
    const handler = createDashboardHandler(deps);
    await handler(req, res, next);

    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("Signature Verification: SHOPIFY"),
    );
  });

  test("should return disabled status in text/plain response", async () => {
    req.headers["accept"] = "text/plain";
    jest.mocked(deps.getSignatureStatus).mockReturnValue(null);
    const handler = createDashboardHandler(deps);
    await handler(req, res, next);

    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("Signature Verification: Disabled"),
    );
  });
});
