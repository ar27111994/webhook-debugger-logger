import { jest } from "@jest/globals";

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
const axios = (await import("axios")).default;
const { Actor } = await import("apify");

describe("Logger Middleware", () => {
  let webhookManager;
  let options;
  let onEvent;

  beforeEach(() => {
    webhookManager = {
      isValid: jest.fn().mockReturnValue(true),
      getWebhookData: jest.fn().mockReturnValue({}),
    };
    onEvent = jest.fn();
    options = {
      maxPayloadSize: 1024,
      authKey: "secret",
      allowedIps: [],
    };
  });

  test("should block invalid webhook ID", async () => {
    webhookManager.isValid.mockReturnValue(false);
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
      body: "original",
    });
    const res = httpMocks.createResponse();

    // Mock sendResponse logic which triggers onEvent
    await middleware(req, res);

    // The middleware ends by calling res.send/json after onEvent
    // We check the event passed to onEvent
    const event = onEvent.mock.calls[0][0];
    expect(event.body).toBe("TRANSFORMED");
  });
});
