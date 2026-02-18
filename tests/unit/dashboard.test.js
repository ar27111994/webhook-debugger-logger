import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import {
  createMockWebhookManager,
  loggerMock,
  fsPromisesMock as mockFs,
} from "../setup/helpers/shared-mocks.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";
import { HTTP_STATUS, HTTP_STATUS_MESSAGES } from "../../src/consts/http.js";

// Setup common mocks (logger, fs)
await setupCommonMocks({ logger: true, fs: true });

const mockReadFile = mockFs.readFile;

// Import module under test
const { createDashboardHandler, preloadTemplate } =
  await import("../../src/routes/dashboard.js");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import("../../src/webhook_manager.js").WebhookManager} WebhookManager
 * @typedef {import("../../src/routes/dashboard.js").DashboardDependencies} DashboardDependencies
 */

describe("Dashboard Handler", () => {
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
    // Default template mock
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValue(
      assertType(
        "<html>{{VERSION}} {{ACTIVE_COUNT}} {{SIGNATURE_BADGE}}</html>",
      ),
    );

    deps = /** @type {DashboardDependencies} */ ({
      webhookManager: mockWebhookManager,
      version: "1.0.0",
      getTemplate: jest.fn(),
      setTemplate: jest.fn(),
      getSignatureStatus: jest.fn(),
    });

    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
  });

  describe("HTML Rendering", () => {
    test("should use cached template if available", async () => {
      jest.mocked(deps.getTemplate).mockReturnValue("<html>Cached</html>");
      const handler = createDashboardHandler(deps);
      await handler(req, res, next);

      expect(res.send).toHaveBeenCalledWith("<html>Cached</html>");
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    test("should load from file on cache miss and set cache", async () => {
      jest.mocked(deps.getTemplate).mockReturnValue(assertType(null));
      const handler = createDashboardHandler(deps);
      await handler(req, res, next);

      expect(mockReadFile).toHaveBeenCalled();
      expect(deps.setTemplate).toHaveBeenCalledWith(
        expect.stringContaining("<html>"),
      );
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining(`v${deps.version}`),
      );
    });

    test("should replace placeholders correctly", async () => {
      const activeCount = 3;
      jest
        .mocked(deps.getTemplate)
        .mockReturnValue("Ver: {{VERSION}}, Count: {{ACTIVE_COUNT}}");
      jest
        .mocked(mockWebhookManager.getAllActive)
        .mockReturnValue(new Array(activeCount)); // Length of activeCount

      const handler = createDashboardHandler(deps);
      await handler(req, res, next);

      expect(res.send).toHaveBeenCalledWith(
        `Ver: v${deps.version}, Count: ${activeCount}`,
      );
    });
  });

  describe("Signature Badge", () => {
    beforeEach(() => {
      jest.mocked(deps.getTemplate).mockReturnValue("{{SIGNATURE_BADGE}}");
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
  });

  describe("Content Negotiation", () => {
    test("should return status in text/plain response", async () => {
      req.headers["accept"] = "text/plain";
      jest.mocked(deps.getSignatureStatus).mockReturnValue("SHOPIFY");
      const handler = createDashboardHandler(deps);
      await handler(req, res, next);

      expect(res.type).toHaveBeenCalledWith("text/plain");
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

    test("should check signature provided from null status", async () => {
      req.headers["accept"] = "text/plain";
      // @ts-expect-error - testing missing prop
      delete deps.getSignatureStatus;

      const handler = createDashboardHandler(deps);
      await handler(req, res, next);

      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining("Signature Verification: Disabled"),
      );
    });

    test("should handle missing accept header", async () => {
      delete req.headers["accept"];

      const handler = createDashboardHandler(deps);
      await handler(req, res, next);

      // Should fall through to HTML
      expect(deps.getTemplate).toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining(`v${deps.version}`),
      );
    });
  });

  describe("Error Handling", () => {
    test("should handle file read error and return 500", async () => {
      jest.mocked(deps.getTemplate).mockReturnValue(assertType(null));
      mockReadFile.mockRejectedValue(assertType(new Error("File not found")));

      const handler = createDashboardHandler(deps);
      await handler(req, res, next);

      expect(loggerMock.error).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      expect(res.send).toHaveBeenCalledWith(
        HTTP_STATUS_MESSAGES[HTTP_STATUS.INTERNAL_SERVER_ERROR],
      );
    });
  });

  describe("preloadTemplate", () => {
    test("should successfully read template", async () => {
      const template = "<html>Template</html>";
      mockReadFile.mockResolvedValue(assertType(template));
      const result = await preloadTemplate();
      expect(result).toBe(template);
      expect(mockReadFile).toHaveBeenCalled();
    });

    test("should return empty string and log warning on failure", async () => {
      mockReadFile.mockRejectedValue(assertType(new Error("Read error")));
      const result = await preloadTemplate();
      expect(result).toBe("");
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.DASHBOARD_PRELOAD_FAILED,
      );
    });
  });
});
