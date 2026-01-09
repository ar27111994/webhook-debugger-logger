import { jest, describe, test, expect, beforeEach } from "@jest/globals";

// Mock axios
jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

// Mock apify
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const { createLoggerMiddleware } = await import("../src/logger_middleware.js");
const httpMocks = (await import("node-mocks-http")).default;

describe("Script Execution Extended", () => {
  /** @type {import('../src/webhook_manager.js').WebhookManager} */
  let webhookManager;
  /** @type {jest.Mock} */
  let onEvent;

  beforeEach(() => {
    webhookManager = /** @type {any} */ ({
      isValid: jest.fn().mockReturnValue(true),
      getWebhookData: jest.fn().mockReturnValue({}),
    });
    onEvent = jest.fn();
  });

  test("should handle script timeout (infinite loop)", async () => {
    const options = {
      customScript: "while(true) {}",
      maxPayloadSize: 1024,
      allowedIps: [],
      authKey: "abc",
    };

    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "abc" },
    });
    const res = httpMocks.createResponse();

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await middleware(req, res);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SCRIPT-EXEC-ERROR]"),
        expect.stringContaining("Script execution timed out after"),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test("should handle script execution error", async () => {
    const options = {
      customScript: "throw new Error('Boom')",
      maxPayloadSize: 1024,
      allowedIps: [],
      authKey: "abc",
    };

    const middleware = createLoggerMiddleware(webhookManager, options, onEvent);
    const req = httpMocks.createRequest({
      params: { id: "wh_123" },
      query: { key: "abc" },
    });
    const res = httpMocks.createResponse();

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await middleware(req, res);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SCRIPT-EXEC-ERROR]"),
        "Boom",
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
