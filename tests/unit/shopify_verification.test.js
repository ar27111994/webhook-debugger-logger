import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { LoggerMiddleware } from "../../src/logger_middleware.js";
import { jsonParserMiddleware } from "../../src/middleware/json_parser.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { createShopifySignature } from "../setup/helpers/signature-utils.js";
import { appEvents, EVENT_NAMES as EVENTS } from "../../src/utils/events.js";
import {
  createMockWebhookManager,
  constsMock,
} from "../setup/helpers/shared-mocks.js";
import { Actor } from "apify";
import { ENCODINGS, HTTP_HEADERS, MIME_TYPES } from "../../src/consts/http.js";
import { SIGNATURE_PROVIDERS } from "../../src/consts/security.js";
import { ERROR_LABELS, SIGNATURE_ERRORS } from "../../src/consts/errors.js";
import { APP_CONSTS } from "../../src/consts/app.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../src/webhook_manager.js').WebhookData} WebhookData
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {Request & { rawBody?: Buffer }} RequestWithBody
 */

describe("Shopify Signature Verification (Raw Body)", () => {
  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;

  // Mock WebhookManager
  const webhookManagerMock = createMockWebhookManager();

  beforeEach(() => {
    jest
      .mocked(webhookManagerMock.getWebhookData)
      .mockReturnValue(/** @type {WebhookData} */({}));
    jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);
    req = createMockRequest({
      params: { id: "wh_test" },
    });
    res = createMockResponse();
    next = createMockNextFunction();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("should verify valid Shopify signature using rawBody even after JSON parsing", async () => {
    const secret = "shared_secret";
    const originalPayload = '{\n  "amount": 100.00\n}';
    const payloadBuffer = Buffer.from(originalPayload, ENCODINGS.UTF8);
    const signature = createShopifySignature(originalPayload, secret);

    req.headers = {
      [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
      [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: signature,
      [HTTP_HEADERS.CONTENT_LENGTH]: String(payloadBuffer.length),
    };
    req.body = payloadBuffer;

    jsonParserMiddleware(req, res, next);

    /** @type {RequestWithBody} */
    const typedReq = req;
    expect(typedReq.rawBody).toBeDefined();
    expect(typedReq.rawBody?.toString(ENCODINGS.UTF8)).toBe(originalPayload);
    expect(req.body).toEqual({ amount: 100 });

    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: SIGNATURE_PROVIDERS.SHOPIFY,
          secret: secret,
        },
      },
      () => { },
    );

    const mw = assertType(middleware);
    const emitSpy = jest.spyOn(appEvents, "emit");
    jest.spyOn(Actor, "pushData").mockResolvedValue(assertType(undefined));

    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });

    await middleware.middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(constsMock.HTTP_STATUS.OK);
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LOG_RECEIVED,
      expect.any(Object),
    );

    /** @type {WebhookEvent} */
    const event = assertType(
      emitSpy.mock.calls.find((call) => call[0] === EVENTS.LOG_RECEIVED)?.[1],
    );
    expect(event.signatureValid).toBe(true);
    expect(event.signatureProvider).toBe(SIGNATURE_PROVIDERS.SHOPIFY);
  });

  test("should fail Shopify signature if rawBody does not match", async () => {
    const secret = "shared_secret";
    const originalPayload = '{"foo":"bar"}';
    const payloadBuffer = Buffer.from(originalPayload, ENCODINGS.UTF8);
    const signature = createShopifySignature("different_payload", secret);

    req.headers = {
      [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
      [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: signature,
      [HTTP_HEADERS.CONTENT_LENGTH]: String(payloadBuffer.length),
    };
    req.body = payloadBuffer;

    jsonParserMiddleware(req, res, next);

    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: SIGNATURE_PROVIDERS.SHOPIFY,
          secret: secret,
        },
      },
      () => { },
    );

    const mw = assertType(middleware);
    const emitSpy = jest.spyOn(appEvents, "emit");
    jest.spyOn(Actor, "pushData").mockResolvedValue(assertType(undefined));

    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });

    await middleware.middleware(req, res, next);

    /** @type {WebhookEvent} */
    const event = assertType(
      emitSpy.mock.calls.find((call) => call[0] === EVENTS.LOG_RECEIVED)?.[1],
    );
    expect(event.signatureValid).toBe(false);
    expect(event.signatureError).toBe(SIGNATURE_ERRORS.MISMATCH);
    expect(res.status).toHaveBeenCalledWith(
      constsMock.HTTP_STATUS.UNAUTHORIZED,
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: ERROR_LABELS.INVALID_SIGNATURE }),
    );
  });

  test("should fail Shopify signature if timestamp is too old", async () => {
    const originalPayload = JSON.stringify({ amount: 100 });
    const secret = "hush";
    const payloadBuffer = Buffer.from(originalPayload, ENCODINGS.UTF);
    const tenMinutesInSeconds = 600;
    const timestamp = new Date(Date.now() - tenMinutesInSeconds * APP_CONSTS.MS_PER_SECOND).toISOString();
    const signature = createShopifySignature(originalPayload, secret);

    req.headers = {
      [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
      [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: signature,
      [HTTP_HEADERS.SHOPIFY_TRIGGERED_AT]: timestamp,
      [HTTP_HEADERS.CONTENT_LENGTH]: String(payloadBuffer.length),
    };
    req.body = payloadBuffer;

    jsonParserMiddleware(req, res, next);

    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: SIGNATURE_PROVIDERS.SHOPIFY,
          secret: secret,
        },
      },
      () => { },
    );

    const mw = assertType(middleware);
    const emitSpy = jest.spyOn(appEvents, "emit");
    jest.spyOn(Actor, "pushData").mockResolvedValue(assertType(undefined));

    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });

    await middleware.middleware(req, res, next);

    /** @type {WebhookEvent} */
    const event = assertType(
      emitSpy.mock.calls.find((call) => call[0] === EVENTS.LOG_RECEIVED)?.[1],
    );
    expect(event.signatureValid).toBe(false);
    expect(event.signatureError).toEqual(
      expect.stringContaining(SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE),
    );
    expect(res.status).toHaveBeenCalledWith(
      constsMock.HTTP_STATUS.UNAUTHORIZED,
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: ERROR_LABELS.INVALID_SIGNATURE }),
    );
  });

  test("should verify valid Shopify signature with fresh timestamp", async () => {
    const originalPayload = JSON.stringify({ amount: 100 });
    const secret = "hush";
    const payloadBuffer = Buffer.from(originalPayload, ENCODINGS.UTF);
    const timestamp = new Date().toISOString();
    const signature = createShopifySignature(originalPayload, secret);

    req.headers = {
      [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
      [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: signature,
      [HTTP_HEADERS.SHOPIFY_TRIGGERED_AT]: timestamp,
      [HTTP_HEADERS.CONTENT_LENGTH]: String(payloadBuffer.length),
    };
    req.body = payloadBuffer;

    jsonParserMiddleware(req, res, next);

    const middleware = new LoggerMiddleware(
      webhookManagerMock,
      {
        signatureVerification: {
          provider: SIGNATURE_PROVIDERS.SHOPIFY,
          secret: secret,
        },
      },
      () => { },
    );

    const mw = assertType(middleware);
    const emitSpy = jest.spyOn(appEvents, "emit");
    jest.spyOn(Actor, "pushData").mockResolvedValue(assertType(undefined));

    mw._validateWebhookRequest = jest.fn().mockReturnValue({
      isValid: true,
      contentLength: payloadBuffer.length,
      remoteIp: "127.0.0.1",
    });

    await middleware.middleware(req, res, next);

    /** @type {WebhookEvent} */
    const event = emitSpy.mock.calls.find(
      (call) => call[0] === EVENTS.LOG_RECEIVED,
    )?.[1];
    expect(event).toBeDefined();
    expect(event.signatureValid).toBe(true);
  });
});
