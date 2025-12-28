import { jest } from "@jest/globals";

jest.unstable_mockModule("axios", () => ({
  default: {
    post: jest.fn().mockResolvedValue({ status: 200 }),
  },
}));

jest.unstable_mockModule("apify", () => ({
  Actor: {
    pushData: jest.fn().mockResolvedValue({}),
  },
}));

const { createLoggerMiddleware } = await import("../src/logger_middleware.js");
const httpMocks = (await import("node-mocks-http")).default;
const axios = (await import("axios")).default;

describe("Forwarding Security", () => {
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
      forwardUrl: "http://target.com/ingest",
      forwardHeaders: true,
      authKey: "secret",
    };
    jest.clearAllMocks();
  });

  test("should strip sensitive headers when forwarding even if forwardHeaders is true", async () => {
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
        cookie: "session=123",
        "x-api-key": "my-key",
        "user-agent": "test-agent",
      },
      body: { foo: "bar" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    const axiosCall = axios.post.mock.calls[0];
    expect(axiosCall).toBeDefined();

    const sentHeaders = axiosCall[2].headers;
    expect(sentHeaders["authorization"]).toBeUndefined();
    expect(sentHeaders["cookie"]).toBeUndefined();
    expect(sentHeaders["x-api-key"]).toBeUndefined();
    expect(sentHeaders["user-agent"]).toBe("test-agent");
    expect(sentHeaders["X-Forwarded-By"]).toBe("Apify-Webhook-Debugger");
  });

  test("should strip almost all headers if forwardHeaders is false", async () => {
    options.forwardHeaders = false;
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
        "content-length": "15",
        "user-agent": "test-agent",
        "x-custom": "value",
      },
      body: { foo: "bar" },
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    const axiosCall = axios.post.mock.calls[0];
    const sentHeaders = axiosCall[2].headers;

    expect(sentHeaders["content-type"]).toBe("application/json");
    expect(sentHeaders["content-length"]).toBe("15");
    expect(sentHeaders["user-agent"]).toBeUndefined();
    expect(sentHeaders["x-custom"]).toBeUndefined();
    expect(sentHeaders["X-Forwarded-By"]).toBe("Apify-Webhook-Debugger");
  });

  test("should handle missing forwardUrl gracefully (no forwarding)", async () => {
    delete options.forwardUrl;
    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      headers: {},
    });
    const res = httpMocks.createResponse();

    await middleware(req, res);

    expect(axios.post).not.toHaveBeenCalled();
  });
});
