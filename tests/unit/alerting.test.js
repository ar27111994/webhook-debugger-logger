import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  axiosMock,
  loggerMock,
  constsMock,
} from "../setup/helpers/shared-mocks.js";
import { ALERT_CHANNELS, DISCORD_COLORS } from "../../src/consts/alerting.js";
import { HTTP_STATUS } from "../../src/consts/http.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";

/**
 * @typedef {import("../../src/utils/alerting.js").AlertTrigger} AlertTrigger
 * @typedef {import("../../src/utils/alerting.js").AlertPayload} AlertPayload
 */

// Mock axios and logger before importing the module
await setupCommonMocks({ axios: true, logger: true, ssrf: true });

const { shouldAlert, sendAlert, triggerAlertIfNeeded } =
  await import("../../src/utils/alerting.js");

describe("Alerting", () => {
  jest.setTimeout(15000);
  beforeEach(() => {
    axiosMock.post.mockClear();
    loggerMock.error.mockClear();
  });

  describe("shouldAlert", () => {
    test("should trigger on error when alertOn includes 'error'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.ERROR,
        ]),
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
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.STATUS_4XX,
        ]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: HTTP_STATUS.NOT_FOUND,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true);
    });

    test("should trigger on 5xx when alertOn includes '5xx'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.STATUS_5XX,
        ]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true);
    });

    test("should trigger on timeout when alertOn includes 'timeout'", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.TIMEOUT,
        ]),
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
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.SIGNATURE_INVALID,
        ]),
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
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.ERROR,
        ]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: HTTP_STATUS.OK,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(false);
    });

    test("should use default alertOn when not specified", () => {
      const config = {};
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(true); // Default includes 5xx
    });

    test("should cover break statements when triggers present but conditions not met", () => {
      const config = {
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.STATUS_4XX,
          constsMock.ALERT_TRIGGERS.STATUS_5XX,
          constsMock.ALERT_TRIGGERS.TIMEOUT,
          constsMock.ALERT_TRIGGERS.SIGNATURE_INVALID,
        ]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: HTTP_STATUS.OK, // Not 4xx or 5xx
        error: "Not a tim-e-out", // Not timeout
        signatureValid: true, // Not invalid
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(false);
    });
  });

  describe("sendAlert", () => {
    test("should send Slack notification", async () => {
      axiosMock.post.mockResolvedValueOnce({ status: HTTP_STATUS.OK });

      const config = {
        [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://hooks.slack.com/test" },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
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
      axiosMock.post.mockResolvedValueOnce({ status: HTTP_STATUS.OK });

      const config = {
        [ALERT_CHANNELS.DISCORD]: {
          webhookUrl: "https://discord.com/api/webhooks/test",
        },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
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

    test("should handle Slack failure gracefully and log specific error", async () => {
      const networkError = new Error("Slack Network error");
      axiosMock.post.mockRejectedValueOnce(networkError);

      const config = {
        [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://hooks.slack.com/test" },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        error: "Test error",
        timestamp: new Date().toISOString(),
      };

      const result = await sendAlert(config, context);

      expect(result.slack).toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "Slack Network error" }),
        }),
        LOG_MESSAGES.SLACK_NOTIF_FAILED,
      );
    });

    test("should handle Discord failure gracefully and log specific error", async () => {
      const networkError = new Error("Discord Network error");
      axiosMock.post.mockRejectedValueOnce(networkError);

      const config = {
        [ALERT_CHANNELS.DISCORD]: {
          webhookUrl: "https://discord.com/api/webhooks/test",
        },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        error: "Test error",
        timestamp: new Date().toISOString(),
      };

      const result = await sendAlert(config, context);

      expect(result.discord).toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "Discord Network error" }),
        }),
        LOG_MESSAGES.DISCORD_NOTIF_FAILED,
      );
    });

    test("should send to multiple channels", async () => {
      axiosMock.post.mockResolvedValue({ status: 200 });

      const config = {
        [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://hooks.slack.com/test" },
        [ALERT_CHANNELS.DISCORD]: {
          webhookUrl: "https://discord.com/api/webhooks/test",
        },
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

    test("should include sourceIp in Slack payload when provided", async () => {
      axiosMock.post.mockResolvedValueOnce({ status: HTTP_STATUS.OK });
      const config = {
        [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://hooks.slack.com/test" },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        statusCode: HTTP_STATUS.OK, // Just to have a status
        timestamp: "2023-01-01T00:00:00Z",
        sourceIp: "1.2.3.4",
        alertOn: [constsMock.ALERT_TRIGGERS.ERROR], // irrelevant for sendAlert but good for context
      };

      await sendAlert(config, context);

      const callArgs = axiosMock.post.mock.calls[0];
      /** @type {AlertPayload} */
      const payload = callArgs[1];

      const contextBlock = payload.blocks?.find((b) => b.type === "context");
      expect(contextBlock).toBeDefined();
      expect(contextBlock?.elements?.[0].text).toContain("1.2.3.4");
    });

    test("should include sourceIp in Discord payload when provided", async () => {
      axiosMock.post.mockResolvedValueOnce({ status: HTTP_STATUS.OK });

      const config = {
        [ALERT_CHANNELS.DISCORD]: {
          webhookUrl: "https://discord.com/api/webhooks/test",
        },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        statusCode: HTTP_STATUS.OK,
        timestamp: "2023-01-01T00:00:00Z",
        sourceIp: "1.2.3.4",
      };

      await sendAlert(config, context);

      const callArgs = axiosMock.post.mock.calls[0];
      /** @type {AlertPayload} */
      const payload = callArgs[1];
      const embed = payload.embeds?.[0];

      const ipField = embed?.fields?.find((f) => f.name === "Source IP");
      expect(ipField).toBeDefined();
      expect(ipField?.value).toBe("1.2.3.4");
    });

    test("should format payload correctly for signature invalid error", async () => {
      axiosMock.post.mockResolvedValue({ status: HTTP_STATUS.OK });

      const config = {
        [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://slack" },
        [ALERT_CHANNELS.DISCORD]: { webhookUrl: "https://discord" },
      };
      const context = {
        webhookId: "wh_123",
        method: "POST",
        signatureValid: false,
        signatureError: "Bad sig",
        timestamp: "2023-01-01T00:00:00Z",
      };

      await sendAlert(config, context);

      // Check Slack
      /** @type {AlertPayload} */
      const slackPayload = axiosMock.post.mock.calls[0][1];
      const slackHeader = slackPayload.blocks?.find(
        (b) => b.type === "header",
      )?.text;
      expect(slackHeader?.text).toContain("⚠️"); // Warning emoji
      const slackFields = slackPayload.blocks?.find(
        (b) => b.type === "section",
      )?.fields;
      expect(
        slackFields?.some((f) => f.text.includes("Signature Invalid")),
      ).toBe(true);

      // Check Discord
      /** @type {AlertPayload} */
      const discordPayload = axiosMock.post.mock.calls[1][1];
      const embed = discordPayload.embeds?.[0];
      expect(embed?.color).toBe(DISCORD_COLORS.ORANGE); // Orange
      expect(embed?.fields?.some((f) => f.value.includes("Bad sig"))).toBe(
        true,
      );
    });

    test("should treat empty alertOn array as no alerts", () => {
      const config = {
        alertOn: [],
      };
      const context = {
        webhookId: "test",
        method: "POST",
        error: "Test",
        timestamp: new Date().toISOString(),
      };
      expect(shouldAlert(config, context)).toBe(false);
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
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.ERROR,
        ]),
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
      axiosMock.post.mockResolvedValueOnce({ status: HTTP_STATUS.OK });

      const config = {
        [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://hooks.slack.com/test" },
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.STATUS_5XX,
        ]),
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
        [ALERT_CHANNELS.SLACK]: { webhookUrl: "https://hooks.slack.com/test" },
        alertOn: /** @type {AlertTrigger[]} */ ([
          constsMock.ALERT_TRIGGERS.ERROR,
        ]),
      };
      const context = {
        webhookId: "test",
        method: "POST",
        statusCode: HTTP_STATUS.OK,
        timestamp: new Date().toISOString(),
      };

      await triggerAlertIfNeeded(config, context);

      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });
});
