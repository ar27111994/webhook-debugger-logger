import { jest, describe, test, expect, beforeEach } from "@jest/globals";

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const { createLoggerMiddleware } = await import("../src/logger_middleware.js");
const httpMocks = (await import("node-mocks-http")).default;

describe("Logger Middleware", () => {
  /** @type {import('../src/webhook_manager.js').WebhookManager} */
  let webhookManager;
  /** @type {import('../src/logger_middleware.js').LoggerOptions} */
  let options;
  /** @type {jest.Mock} */
  let onEvent;

  beforeEach(() => {
    webhookManager = /** @type {any} */ ({
      isValid: jest.fn().mockReturnValue(true),
      getWebhookData: jest.fn().mockReturnValue({}),
    });
    onEvent = jest.fn();
    options = {
      maxPayloadSize: 1024,
      authKey: "secret",
      allowedIps: [],
    };
  });

  test("should block invalid webhook ID", async () => {
    /** @type {jest.Mock} */ (webhookManager.isValid).mockReturnValue(false);
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({ params: { id: "invalid" } });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(404);
  });

  test("should block unauthorized requests (Auth Key)", async () => {
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "wrong" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(401);
  });

  test("should block requests from non-whitelisted IPs", async () => {
    options.allowedIps = ["1.1.1.1"];
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      ip: "2.2.2.2",
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(403);
  });

  test("should block oversized payloads", async () => {
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "secret" }, // Bypass Auth
      headers: { "content-length": "2048" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(413);
  });

  test("should validate JSON Schema", async () => {
    options.jsonSchema = { type: "object", required: ["foo"] };
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      method: "POST",
      query: { key: "secret" }, // Bypass Auth
      headers: { "content-type": "application/json" },
      body: { bar: 1 },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(400);
  });

  test("should execute custom script", async () => {
    options.customScript = "event.body = 'TRANSFORMED';";
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "secret" }, // Bypass Auth
      body: /** @type {any} */ ("original"),
    });
    const res = httpMocks.createResponse();

    // Mock sendResponse logic which triggers onEvent
    await middleware(req, res);

    // The middleware ends by calling res.send/json after onEvent
    // We check the event passed to onEvent
    const event = /** @type {any} */ (onEvent.mock.calls[0][0]);
    expect(event.body).toBe("TRANSFORMED");
  });

  test("should convert Buffer body to string for logging", async () => {
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const bufferContent = Buffer.from('{"key":"value"}');
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "secret" },
      headers: { "content-type": "application/json" },
      body: bufferContent,
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    const event = /** @type {any} */ (onEvent.mock.calls[0][0]);
    expect(typeof event.body).toBe("string");
    expect(event.body).toContain("key");
  });

  test("should calculate size correctly for object bodies", async () => {
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const bodyObj = { foo: "bar", baz: 123 };
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "secret" },
      headers: { "content-type": "application/json" },
      body: bodyObj,
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    const event = /** @type {any} */ (onEvent.mock.calls[0][0]);
    // {"foo":"bar","baz":123} is 23 chars
    expect(event.size).toBe(Buffer.byteLength(JSON.stringify(bodyObj)));
  });

  test("should handle array auth key by taking first element", async () => {
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: ["secret", "wrong"] },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(200);
  });

  test("should return JSON response for 4xx error status codes", async () => {
    options.defaultResponseCode = 400;
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "secret" },
      body: { test: "data" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(400);
    // 4xx with no custom body should return a JSON object
    const responseData = res._getJSONData();
    expect(responseData).toHaveProperty("webhookId");
  });

  test("should return object responseBody as JSON", async () => {
    options.defaultResponseCode = 200;
    /** @type {any} */ (options).defaultResponseBody = {
      status: "ok",
      custom: "response",
    };
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "secret" },
      body: { test: "data" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.statusCode).toBe(200);
    const responseData = res._getJSONData();
    expect(responseData.status).toBe("ok");
    expect(responseData.custom).toBe("response");
  });

  test("should apply custom response headers from options", async () => {
    options.defaultResponseHeaders = { "X-Custom-Header": "CustomValue" };
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "secret" },
      body: { test: "data" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(res.getHeader("X-Custom-Header")).toBe("CustomValue");
  });
});
