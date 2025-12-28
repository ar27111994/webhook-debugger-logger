import { jest } from "@jest/globals";
import httpMocks from "node-mocks-http";

// Mock axios
jest.unstable_mockModule("axios", async () => {
  return { default: jest.fn().mockResolvedValue({ status: 200, data: "OK" }) };
});

// Mock Apify
jest.unstable_mockModule("apify", async () => {
  const { createApifyMock } = await import("./helpers/apify-mock.js");
  return {
    Actor: createApifyMock({
      authKey: "secret",
    }),
  };
});

const { createLoggerMiddleware } = await import("../src/logger_middleware.js");

describe("Custom Script Timeout", () => {
  let webhookId = "wh_test_123";
  let webhookManager;

  beforeEach(() => {
    webhookManager = {
      isValid: jest.fn().mockReturnValue(true),
      getWebhookData: jest.fn().mockReturnValue({}),
    };
  });

  test("Should terminate infinite loop script within 1s", async () => {
    // We'll create a fresh middleware with a dangerous script
    const dangerousScript = "while(true) {}";
    const onEvent = jest.fn();
    const middleware = await createLoggerMiddleware(
      webhookManager,
      {
        ...webhookManager.getWebhookData(webhookId),
        customScript: dangerousScript,
        authKey: "secret",
      },
      onEvent
    );

    const req = httpMocks.createRequest({
      params: { id: webhookId },
      query: { key: "secret" },
      body: { test: "infinite" },
      headers: { "content-type": "application/json" },
    });
    const res = httpMocks.createResponse();

    const startTime = Date.now();
    await middleware(req, res);
    const duration = Date.now() - startTime;

    // Response should be sent despite the script error
    expect(res.statusCode).toBe(200);
    // Script should have been terminated around 1s
    expect(duration).toBeGreaterThanOrEqual(1000);
    expect(duration).toBeLessThan(2000);
  }, 5000);
});
