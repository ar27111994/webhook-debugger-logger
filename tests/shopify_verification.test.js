import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { LoggerMiddleware } from "../src/logger_middleware.js";
import { jsonParserMiddleware } from "../src/middleware/json_parser.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "./helpers/test-utils.js";
import { createShopifySignature } from "./helpers/signature-utils.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../src/webhook_manager.js').WebhookData} WebhookData
 * @typedef {import('../src/logger_middleware.js').WebhookEvent} WebhookEvent
 * @typedef {Request & { rawBody?: Buffer }} RequestWithBody
 */

// Mock WebhookManager
import { createMockWebhookManager } from "./helpers/shared-mocks.js";
const webhookManagerMock = createMockWebhookManager();

describe("Shopify Signature Verification (Raw Body)", () => {
  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;

  beforeEach(() => {
    jest
      .mocked(webhookManagerMock.getWebhookData)
      .mockReturnValue(/** @type {WebhookData} */ ({}));
    jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);
    req = createMockRequest({
      params: { id: "wh_test" },
    });
    res = createMockResponse();
    next = createMockNextFunction();
  });

  test("should verify valid Shopify signature using rawBody even after JSON parsing", async () => {
    const secret = "shared_secret";
    // Create a payload with specific whitespace to test raw vs parsed difference
    const originalPayload = '{\n  "amount": 100.00\n}';
    const payloadBuffer = Buffer.from(originalPayload, "utf8");

    // Calculate expected HMAC based on ORIGINAL payload
    // Calculate expected HMAC based on ORIGINAL payload
    const signature = createShopifySignature(originalPayload, secret);

    // Setup request
    req.headers = {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": signature,
      "content-length": String(payloadBuffer.length),
    };
    req.body = payloadBuffer; // Start with Buffer (as from body-parser)

    // 1. Run JSON Parser Middleware
    // This should populate req.rawBody and parse req.body
    jsonParserMiddleware(req, res, next);

    const typedReq = /** @type {RequestWithBody} */ (req);
    expect(typedReq.rawBody).toBeDefined();
    expect(typedReq.rawBody?.toString("utf8")).toBe(originalPayload);
    expect(req.body).toEqual({ amount: 100 }); // Parsed object

    // 2. Run Logger Middleware with Verification Config
    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: "shopify",
          secret: secret,
        },
      },
      () => {}, // onEvent
    );

    // Cast to any to access private methods for mocking
    const mw = assertType(middleware);

    // Mock validation methods inside middleware
    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });
    mw._executeBackgroundTasks = /** @type {jest.Mock<any>} */ (
      jest.fn()
    ).mockResolvedValue(undefined);

    await middleware.middleware(req, res, next);

    // Verify successful response (200 OK)
    expect(res.status).toHaveBeenCalledWith(200);

    // Check if signature was marked valid in the event
    const executeTasksMock = /** @type {jest.Mock} */ (
      mw._executeBackgroundTasks
    );
    expect(executeTasksMock).toHaveBeenCalled();
    const event = /** @type {WebhookEvent} */ (
      executeTasksMock.mock.calls[0][0]
    );

    expect(event.signatureValid).toBe(true);
    expect(event.signatureProvider).toBe("shopify");
  });

  test("should fail Shopify signature if rawBody does not match", async () => {
    const secret = "shared_secret";
    const originalPayload = '{"foo":"bar"}';
    const payloadBuffer = Buffer.from(originalPayload, "utf8");

    // Signature for DIFFERENT payload
    // Signature for DIFFERENT payload
    const signature = createShopifySignature("different_payload", secret);

    req.headers = {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": signature,
      "content-length": String(payloadBuffer.length),
    };
    req.body = payloadBuffer;

    jsonParserMiddleware(req, res, next);

    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: "shopify",
          secret: secret,
        },
      },
      () => {},
    );

    const mw = assertType(middleware);

    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });
    mw._executeBackgroundTasks = /** @type {jest.Mock<any>} */ (
      jest.fn()
    ).mockResolvedValue(undefined);

    await middleware.middleware(req, res, next);

    const executeTasksMock = /** @type {jest.Mock<any>} */ (
      mw._executeBackgroundTasks
    );
    const event = /** @type {WebhookEvent} */ (
      executeTasksMock.mock.calls[0][0]
    );
    expect(event.signatureValid).toBe(false);
    expect(event.signatureError).toBe("Signature mismatch");
  });

  test("should fail Shopify signature if timestamp is too old", async () => {
    const originalPayload = JSON.stringify({ amount: 100 });
    const secret = "hush";
    const payloadBuffer = Buffer.from(originalPayload, "utf8");
    // 10 minutes ago
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const signature = createShopifySignature(originalPayload, secret);

    req.headers = {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": signature,
      "x-shopify-triggered-at": timestamp, // Stale timestamp
      "content-length": String(payloadBuffer.length),
    };
    req.body = payloadBuffer;

    jsonParserMiddleware(req, res, next);

    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: "shopify",
          secret: secret,
        },
      },
      () => {},
    );

    const mw = assertType(middleware);

    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });

    mw._executeBackgroundTasks = /** @type {jest.Mock<any>} */ (
      jest.fn()
    ).mockResolvedValue(undefined);

    await middleware.middleware(req, res, next);

    const executeTasksMock = /** @type {jest.Mock<any>} */ (
      mw._executeBackgroundTasks
    );
    const event = /** @type {WebhookEvent} */ (
      executeTasksMock.mock.calls[0][0]
    );

    expect(event.signatureValid).toBe(false);
    expect(event.signatureError).toEqual(
      expect.stringContaining("Timestamp outside tolerance"),
    );
  });

  test("should verify valid Shopify signature with fresh timestamp", async () => {
    const originalPayload = JSON.stringify({ amount: 100 });
    const secret = "hush";
    const payloadBuffer = Buffer.from(originalPayload, "utf8");
    const timestamp = new Date().toISOString(); // Fresh

    const signature = createShopifySignature(originalPayload, secret);

    req.headers = {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": signature,
      "x-shopify-triggered-at": timestamp,
      "content-length": String(payloadBuffer.length),
    };
    req.body = payloadBuffer;

    jsonParserMiddleware(req, res, next);

    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: "shopify",
          secret: secret,
        },
      },
      () => {},
    );

    const mw = assertType(middleware);

    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });

    mw._executeBackgroundTasks = /** @type {jest.Mock<any>} */ (
      jest.fn()
    ).mockResolvedValue(undefined);

    await middleware.middleware(req, res, next);

    const executeTasksMock = /** @type {jest.Mock<any>} */ (
      mw._executeBackgroundTasks
    );
    const event = /** @type {WebhookEvent} */ (
      executeTasksMock.mock.calls[0][0]
    );

    expect(event.signatureValid).toBe(true);
  });
});
