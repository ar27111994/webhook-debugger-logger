/**
 * @file tests/unit/alerting.test.js
 * @description Unit tests for alerting utilities.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock, axiosMock } from "../setup/helpers/shared-mocks.js";
import { assertType } from "../setup/helpers/test-utils.js";
import { ALERT_TRIGGERS } from "../../src/consts/alerting.js";
import { APP_CONSTS } from "../../src/consts/app.js";
import {
  HTTP_METHODS,
  HTTP_STATUS,
  HTTP_STATUS_MESSAGES,
} from "../../src/consts/http.js";

// Mock dependencies
const mockValidateUrlForSsrf = jest.fn();
jest.unstable_mockModule("../../src/utils/ssrf.js", () => ({
  validateUrlForSsrf: mockValidateUrlForSsrf,
}));

// Setup shared mocks
await setupCommonMocks({ logger: true, axios: true });

await jest.resetModules();

// Import module under test
const { shouldAlert, sendAlert, triggerAlertIfNeeded } =
  await import("../../src/utils/alerting.js");

describe("Alerting Utils", () => {
  const SLACK_HOOK = "https://hooks.slack.com/services/XXX";
  const DISCORD_HOOK = "https://discord.com/api/webhooks/YYY";

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateUrlForSsrf.mockResolvedValue(assertType({ safe: true }));
    axiosMock.post.mockResolvedValue({ status: HTTP_STATUS.OK });
  });

  describe("shouldAlert", () => {
    const config = {
      alertOn: [ALERT_TRIGGERS.ERROR, ALERT_TRIGGERS.STATUS_5XX],
    };

    it("should return true for ERROR trigger", () => {
      expect(
        shouldAlert(config, assertType({ error: "Something went wrong" })),
      ).toBe(true);
    });

    it("should return true for STATUS_5XX trigger", () => {
      expect(
        shouldAlert(
          config,
          assertType({ statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR }),
        ),
      ).toBe(true);
      expect(
        shouldAlert(
          config,
          assertType({ statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE }),
        ),
      ).toBe(true);
    });

    it("should return true for STATUS_4XX trigger", () => {
      const config4xx = { alertOn: [ALERT_TRIGGERS.STATUS_4XX] };
      expect(
        shouldAlert(
          config4xx,
          assertType({ statusCode: HTTP_STATUS.BAD_REQUEST }),
        ),
      ).toBe(true);
      expect(
        shouldAlert(
          config4xx,
          assertType({ statusCode: HTTP_STATUS.NOT_FOUND }),
        ),
      ).toBe(true);
      expect(
        shouldAlert(
          config4xx,
          assertType({ statusCode: HTTP_STATUS.CLIENT_CLOSED_REQUEST }),
        ),
      ).toBe(true);
      expect(
        shouldAlert(
          config4xx,
          assertType({ statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR }),
        ),
      ).toBe(false);
      expect(
        shouldAlert(config4xx, assertType({ statusCode: HTTP_STATUS.OK })),
      ).toBe(false);
    });

    it("should return false if trigger condition not met", () => {
      expect(
        shouldAlert(config, assertType({ statusCode: HTTP_STATUS.OK })),
      ).toBe(false);
      expect(
        shouldAlert(config, assertType({ statusCode: HTTP_STATUS.NOT_FOUND })),
      ).toBe(false); // 4XX not in config
    });

    it("should use default triggers if config.alertOn is missing", () => {
      const emptyConfig = {};
      // Default usually includes ERROR and maybe 5XX? let's check CONST behavior
      // We assume defaults cover at least Errors.
      expect(shouldAlert(emptyConfig, assertType({ error: "Fail" }))).toBe(
        true,
      );
    });

    it("should handle TIMEOUT trigger", () => {
      const timeoutConfig = { alertOn: [ALERT_TRIGGERS.TIMEOUT] };
      expect(
        shouldAlert(
          timeoutConfig,
          assertType({ error: "Request timeout occurred" }),
        ),
      ).toBe(true);
      expect(
        shouldAlert(timeoutConfig, assertType({ error: "Other error" })),
      ).toBe(false);
      expect(shouldAlert(timeoutConfig, assertType({}))).toBe(false); // Hits context.error || "" branch
    });

    it("should handle SIGNATURE_INVALID trigger", () => {
      const sigConfig = { alertOn: [ALERT_TRIGGERS.SIGNATURE_INVALID] };
      expect(
        shouldAlert(sigConfig, assertType({ signatureValid: false })),
      ).toBe(true);
      expect(shouldAlert(sigConfig, assertType({ signatureValid: true }))).toBe(
        false,
      );
    });
  });

  describe("sendAlert", () => {
    const context = {
      webhookId: "hook-123",
      method: HTTP_METHODS.POST,
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      error: HTTP_STATUS_MESSAGES[HTTP_STATUS.INTERNAL_SERVER_ERROR],
      timestamp: "2023-01-01T00:00:00Z",
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      sourceIp: "1.2.3.4",
    };

    it("should send alerts to configured channels", async () => {
      const config = {
        slack: { webhookUrl: SLACK_HOOK },
        discord: { webhookUrl: DISCORD_HOOK },
      };

      const results = await sendAlert(config, assertType(context));

      const callCount = Object.keys(config).length;
      expect(mockValidateUrlForSsrf).toHaveBeenCalledTimes(callCount);
      expect(axiosMock.post).toHaveBeenCalledTimes(callCount);
      expect(results.slack).toBe(true);
      expect(results.discord).toBe(true);
    });

    it("should block SSRF URLs", async () => {
      mockValidateUrlForSsrf.mockResolvedValueOnce(
        assertType({ safe: false, error: "Blocked IP" }),
      );

      const config = {
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        slack: { webhookUrl: "http://169.254.169.254/latest" },
      };

      await sendAlert(config, assertType(context));

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        expect.stringContaining("Slack notification failed"),
      );
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("should block SSRF URLs for Discord", async () => {
      mockValidateUrlForSsrf.mockResolvedValueOnce(
        assertType({ safe: false, error: "Blocked IP" }),
      );

      const config = {
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        discord: { webhookUrl: "http://169.254.169.254/latest" },
      };

      await sendAlert(config, assertType(context));

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        expect.stringContaining("Discord notification failed"),
      );
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("should handle axios errors", async () => {
      axiosMock.post.mockRejectedValueOnce(new Error("Network Error"));

      const config = {
        slack: { webhookUrl: SLACK_HOOK },
      };

      const results = await sendAlert(config, assertType(context));

      expect(results.slack).toBe(false);
      expect(loggerMock.error).toHaveBeenCalled();
    });

    it("should handle axios errors for Discord", async () => {
      axiosMock.post.mockRejectedValueOnce(new Error("Network Error"));

      const config = {
        discord: { webhookUrl: DISCORD_HOOK },
      };

      const results = await sendAlert(config, assertType(context));

      expect(results.discord).toBe(false);
      expect(loggerMock.error).toHaveBeenCalled();
    });

    it("should format Slack message for invalid signatures correctly", async () => {
      const config = { slack: { webhookUrl: SLACK_HOOK } };
      const sigContext = {
        ...context,
        error: undefined,
        signatureValid: false,
        signatureError: "Mismatch",
      };

      await sendAlert(config, assertType(sigContext));
      expect(axiosMock.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining("⚠️"),
              }),
            }),
            expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining("Signature Invalid: Mismatch"),
                }),
              ]),
            }),
          ]),
        }),
        expect.any(Object),
      );
    });

    it("should format Discord message for invalid signatures correctly", async () => {
      const config = { discord: { webhookUrl: DISCORD_HOOK } };
      const sigContext = {
        ...context,
        error: undefined,
        signatureValid: false,
        signatureError: "Mismatch",
      };
      const DISCORD_ORANGE = 16753920;

      await sendAlert(config, assertType(sigContext));
      expect(axiosMock.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              color: DISCORD_ORANGE,
              fields: expect.arrayContaining([
                expect.objectContaining({
                  value: expect.stringContaining("Signature Invalid: Mismatch"),
                }),
              ]),
            }),
          ]),
        }),
        expect.any(Object),
      );
    });

    it("should format message for default OK status correctly (Slack/Discord)", async () => {
      const config = {
        slack: { webhookUrl: SLACK_HOOK },
        discord: { webhookUrl: DISCORD_HOOK },
      };
      const okContext = {
        ...context,
        error: undefined,
        signatureValid: true,
        statusCode: HTTP_STATUS.OK,
        sourceIp: undefined,
      };
      const DISCORD_GREEN = 65280;

      await sendAlert(config, assertType(okContext));

      // Checking Discord default status
      expect(axiosMock.post).toHaveBeenCalledWith(
        DISCORD_HOOK,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              color: DISCORD_GREEN,
              fields: expect.arrayContaining([
                expect.objectContaining({ value: `Status: ${HTTP_STATUS.OK}` }),
              ]),
            }),
          ]),
        }),
        expect.any(Object),
      );

      // Checking Slack default status
      expect(axiosMock.post).toHaveBeenCalledWith(
        SLACK_HOOK,
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining("📩"),
              }),
            }),
            expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining(`Status: ${HTTP_STATUS.OK}`),
                }),
              ]),
            }),
          ]),
        }),
        expect.any(Object),
      );
    });
  });

  describe("triggerAlertIfNeeded", () => {
    it("should trigger alert if conditions met", async () => {
      const config = {
        alertOn: [ALERT_TRIGGERS.ERROR],
        slack: { webhookUrl: "https://slack.com" },
      };
      const context = { error: "Fail" };

      await triggerAlertIfNeeded(config, assertType(context));

      expect(axiosMock.post).toHaveBeenCalled();
    });

    it("should skip alert if no channels configured", async () => {
      const config = { alertOn: [ALERT_TRIGGERS.ERROR] }; // No URLs
      const context = { error: "Fail" };

      await triggerAlertIfNeeded(config, assertType(context));

      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("should skip alert if condition not met", async () => {
      const config = {
        alertOn: [ALERT_TRIGGERS.ERROR],
        slack: { webhookUrl: SLACK_HOOK },
      };
      const context = { statusCode: HTTP_STATUS.OK }; // No error

      await triggerAlertIfNeeded(config, assertType(context));

      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("should exit cleanly if config is undefined", async () => {
      await triggerAlertIfNeeded(undefined, assertType({ error: "Fail" }));
      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });

  describe("Security and Sanitation", () => {
    it("should safely process context with prototype pollution attempts", async () => {
      const malformedContext = JSON.parse(
        '{"__proto__": {"admin": true}, "error": "Proto pollution test"}',
      );
      const config = { slack: { webhookUrl: SLACK_HOOK } };

      await sendAlert(config, assertType(malformedContext));

      expect(axiosMock.post).toHaveBeenCalled();
      const calledPayload = axiosMock.post.mock.calls[0][1];
      expect(calledPayload.admin).toBeUndefined(); // Should not bleed prototype
    });

    it("should handle extremely large error strings without throwing unhandled exceptions", async () => {
      const config = { slack: { webhookUrl: SLACK_HOOK } };
      const MB_SIZE = 5;
      const massiveError = "A".repeat(
        APP_CONSTS.BYTES_PER_KB * APP_CONSTS.BYTES_PER_KB * MB_SIZE,
      ); // 5 MB string
      const context = {
        error: massiveError,
        method: HTTP_METHODS.POST,
        timestamp: new Date().toISOString(),
      };

      await sendAlert(config, assertType(context));
      expect(axiosMock.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          blocks: expect.any(Array),
        }),
        expect.any(Object),
      );
    });
  });

  describe("Stress and Concurrency", () => {
    it("should safely handle many concurrent alert triggers", async () => {
      const config = {
        slack: { webhookUrl: SLACK_HOOK },
        discord: { webhookUrl: DISCORD_HOOK },
      };
      const context = {
        error: "Concurrent test",
        method: HTTP_METHODS.GET,
        timestamp: new Date().toISOString(),
      };

      const promises = [];
      const CONCURRENT_ALERTS = 100;

      // Fire off 100 alerts simultaneously
      for (let i = 0; i < CONCURRENT_ALERTS; i++) {
        promises.push(sendAlert(config, assertType(context)));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(CONCURRENT_ALERTS);
      // Since axios is mocked, we expect 2 API calls per sendAlert (one slack, one discord)
      // But since validateUrlForSsrf is also called, we can just check axiosMock invocations
      expect(axiosMock.post).toHaveBeenCalledTimes(CONCURRENT_ALERTS * (1 + 1));

      // Check that all promises resolved successfully
      results.forEach((res) => {
        expect(res.slack).toBe(true);
        expect(res.discord).toBe(true);
      });
    });
  });
});
