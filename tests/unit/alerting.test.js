import { describe, test, expect, beforeEach } from "@jest/globals";
import { axiosMock } from "../setup/helpers/shared-mocks.js";

/**
 * @typedef {import("../../src/utils/alerting.js").AlertTrigger} AlertTrigger
 */

// Mock axios before importing the module
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true });

const { shouldAlert, sendAlert, triggerAlertIfNeeded } =
  await import("../../src/utils/alerting.js");

describe("Alerting", () => {
  beforeEach(() => {
    axiosMock.post.mockClear();
  });

  describe("shouldAlert", () => {
    test("should trigger on error when alertOn includes 'error'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ (["error"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        error: "Connection failed",
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true);
    });

    test("should trigger on 4xx when alertOn includes '4xx'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ (["4xx"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: 404,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true);
    });

    test("should trigger on 5xx when alertOn includes '5xx'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ (["5xx"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: 503,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true);
    });

    test("should trigger on timeout when alertOn includes 'timeout'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ (["timeout"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        error: "Request timeout",
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true);
    });

    test("should trigger on invalid signature when alertOn includes 'signature_invalid'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ (["signature_invalid"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        signatureValid: false,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true);
    });

    test("should not trigger when conditions not met", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ (["error"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: 200,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(false);
    });

    test("should use default alertOn when not specified", () => {
      const config = {};
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: 500,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true); // Default includes 5xx
    });
  });

  describe("sendAlert", () => {
    test("should send Slack notification", async () => {
      axiosMock.post.mockResolvedValueOnce({ status: 200 });

      const config = { slack: { webhookUrl: "https://hooks.slack.com/test" } };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        statusCode: 500,
        timestamp: new Date().toISOString(),
      };

      const result = await sendAlert(config, context);

      expect(result.slack).toBe(true);
      expect(axiosMock.post).toHaveBeenCalledWith(
        "https://hooks.slack.com/test",
        expect.objectContaining({ blocks: expect.any(Array) }),
        expect.any(Object),
      );
    });

    test("should send Discord notification", async () => {
      axiosMock.post.mockResolvedValueOnce({ status: 200 });

      const config = {
        discord: { webhookUrl: "https://discord.com/api/webhooks/test" },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        statusCode: 500,
        timestamp: new Date().toISOString(),
      };

      const result = await sendAlert(config, context);

      expect(result.discord).toBe(true);
      expect(axiosMock.post).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/test",
        expect.objectContaining({ embeds: expect.any(Array) }),
        expect.any(Object),
      );
    });

    test("should handle Slack failure gracefully", async () => {
      axiosMock.post.mockRejectedValueOnce(new Error("Network error"));

      const config = { slack: { webhookUrl: "https://hooks.slack.com/test" } };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        error: "Test error",
        timestamp: new Date().toISOString(),
      };

      const result = await sendAlert(config, context);

      expect(result.slack).toBe(false);
    });

    test("should send to multiple channels", async () => {
      axiosMock.post.mockResolvedValue({ status: 200 });

      const config = {
        slack: { webhookUrl: "https://hooks.slack.com/test" },
        discord: { webhookUrl: "https://discord.com/api/webhooks/test" },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        statusCode: 500,
        timestamp: new Date().toISOString(),
      };

      const result = await sendAlert(config, context);

      expect(result.slack).toBe(true);
      expect(result.discord).toBe(true);
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
    });
  });

  describe("triggerAlertIfNeeded", () => {
    test("should not send alert when config is undefined", async () => {
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: 500,
        timestamp: new Date().toISOString(),
      };
      await triggerAlertIfNeeded(undefined, context);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test("should not send alert when no webhook URLs configured", async () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ (["error"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        error: "Test",
        timestamp: new Date().toISOString(),
      };
      await triggerAlertIfNeeded(config, context);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test("should send alert when conditions met", async () => {
      axiosMock.post.mockResolvedValueOnce({ status: 200 });

      const config = {
        slack: { webhookUrl: "https://hooks.slack.com/test" },
        alertOn: /** @type {AlertTrigger[]} */ (["5xx"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: 503,
        timestamp: new Date().toISOString(),
      };

      await triggerAlertIfNeeded(config, context);

      expect(axiosMock.post).toHaveBeenCalled();
    });

    test("should not send alert when conditions not met", async () => {
      const config = {
        slack: { webhookUrl: "https://hooks.slack.com/test" },
        alertOn: /** @type {AlertTrigger[]} */ (["error"]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: 200,
        timestamp: new Date().toISOString(),
      };

      await triggerAlertIfNeeded(config, context);

      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });
});
