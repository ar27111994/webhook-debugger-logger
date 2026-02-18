/**
 * @file src/utils/alerting.js
 * @description Alerting logic for sending notifications to Slack/Discord.
 * @module utils/alerting
 */
import axios from "axios";
import { validateUrlForSsrf } from "./ssrf.js";
import { HTTP_HEADERS, HTTP_STATUS, MIME_TYPES } from "../consts/http.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import {
  ALERT_TRIGGERS,
  SLACK_BLOCK_TYPES,
  DISCORD_COLORS,
  DEFAULT_ALERT_ON,
  ALERT_TIMEOUT_MS,
} from "../consts/alerting.js";
import { createChildLogger, serializeError } from "./logger.js";
import { ERROR_MESSAGES } from "../consts/errors.js";

const log = createChildLogger({ component: LOG_COMPONENTS.ALERTING });

/**
 * @typedef {import("../typedefs.js").AlertTrigger} AlertTrigger
 * @typedef {import("../typedefs.js").AlertChannel} AlertChannel
 * @typedef {import("../typedefs.js").AlertChannelConfig} AlertChannelConfig
 * @typedef {import("../typedefs.js").AlertConfig} AlertConfig
 * @typedef {import("../typedefs.js").AlertContext} AlertContext
 * @typedef {DISCORD_COLORS[keyof typeof DISCORD_COLORS]} DiscordColor
 */

/**
 * @typedef {object} PayloadText
 * @property {string} type
 * @property {string} text
 * @property {boolean} [emoji]
 */

/**
 * @typedef {object} PayloadEmbed
 * @property {string} name
 * @property {string} value
 * @property {boolean} [inline]
 */

/**
 * @typedef {object} AlertPayload
 * @property {{type: string, text?: PayloadText, fields?: PayloadText[], elements?: PayloadText[]}[]} [blocks]
 * @property {{title: string, color: number, fields?: PayloadEmbed[], timestamp: string}[]} [embeds]
 */

/**
 * Checks if an alert should be triggered based on the context and config.
 * @param {AlertConfig} config
 * @param {AlertContext} context
 * @returns {boolean}
 */
export function shouldAlert(config, context) {
  const triggers = config.alertOn || DEFAULT_ALERT_ON;

  for (const trigger of triggers) {
    switch (trigger) {
      case ALERT_TRIGGERS.ERROR:
        if (context.error) return true;
        break;
      case ALERT_TRIGGERS.STATUS_4XX:
        if (
          context.statusCode &&
          context.statusCode >= HTTP_STATUS.BAD_REQUEST &&
          context.statusCode < HTTP_STATUS.INTERNAL_SERVER_ERROR
        )
          return true;
        break;
      case ALERT_TRIGGERS.STATUS_5XX:
        if (
          context.statusCode &&
          context.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR
        )
          return true;
        break;
      case ALERT_TRIGGERS.TIMEOUT:
        if (
          String(context.error || "")
            .toLowerCase()
            .includes(ALERT_TRIGGERS.TIMEOUT)
        )
          return true;
        break;
      case ALERT_TRIGGERS.SIGNATURE_INVALID:
        if (context.signatureValid === false) return true;
        break;
    }
  }

  return false;
}

/**
 * Sends an alert to configured channels.
 * @param {AlertConfig} config
 * @param {AlertContext} context
 * @returns {Promise<Record<AlertChannel, boolean>>}
 */
export async function sendAlert(config, context) {
  const results = /** @type {Record<AlertChannel, boolean>} */ ({});

  const promises = [];

  if (config.slack?.webhookUrl) {
    promises.push(
      sendSlackAlert(config.slack.webhookUrl, context)
        .then(() => {
          results.slack = true;
        })
        .catch((err) => {
          log.error(
            { err: serializeError(err) },
            LOG_MESSAGES.SLACK_NOTIF_FAILED,
          );
          results.slack = false;
        }),
    );
  }

  if (config.discord?.webhookUrl) {
    promises.push(
      sendDiscordAlert(config.discord.webhookUrl, context)
        .then(() => {
          results.discord = true;
        })
        .catch((err) => {
          log.error(
            { err: serializeError(err) },
            LOG_MESSAGES.DISCORD_NOTIF_FAILED,
          );
          results.discord = false;
        }),
    );
  }

  await Promise.all(promises);
  return results;
}

/**
 * Sends a Slack webhook notification.
 * @param {string} webhookUrl
 * @param {AlertContext} context
 * @returns {Promise<void>}
 */
async function sendSlackAlert(webhookUrl, context) {
  const ssrfCheck = await validateUrlForSsrf(webhookUrl);
  if (!ssrfCheck.safe) {
    throw new Error(
      ERROR_MESSAGES.ALERT_URL_BLOCKED_BY_SSRF_POLICY(String(ssrfCheck.error)),
    );
  }
  let emoji = "📩";
  if (context.error) {
    emoji = "🚨";
  } else if (context.signatureValid === false) {
    emoji = "⚠️";
  }

  let status = `Status: ${context.statusCode}`;
  if (context.error) {
    status = `Error: ${context.error}`;
  } else if (context.signatureValid === false) {
    status = `Signature Invalid: ${context.signatureError}`;
  }

  /** @type {AlertPayload} */
  const payload = {
    blocks: [
      {
        type: SLACK_BLOCK_TYPES.HEADER,
        text: {
          type: SLACK_BLOCK_TYPES.PLAIN_TEXT,
          text: `${emoji} Webhook Alert`,
          emoji: true,
        },
      },
      {
        type: SLACK_BLOCK_TYPES.SECTION,
        fields: [
          {
            type: SLACK_BLOCK_TYPES.MARKDOWN,
            text: `*Webhook ID:*\n\`${context.webhookId}\``,
          },
          {
            type: SLACK_BLOCK_TYPES.MARKDOWN,
            text: `*Method:*\n${context.method}`,
          },
          { type: SLACK_BLOCK_TYPES.MARKDOWN, text: `*Status:*\n${status}` },
          {
            type: SLACK_BLOCK_TYPES.MARKDOWN,
            text: `*Time:*\n${context.timestamp}`,
          },
        ],
      },
    ],
  };

  if (context.sourceIp) {
    payload.blocks?.push({
      type: SLACK_BLOCK_TYPES.CONTEXT,
      elements: [
        {
          type: SLACK_BLOCK_TYPES.MARKDOWN,
          text: `Source IP: ${context.sourceIp}`,
        },
      ],
    });
  }

  await axios.post(webhookUrl, payload, {
    timeout: ALERT_TIMEOUT_MS,
    headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
  });
}

/**
 * Sends a Discord webhook notification.
 * @param {string} webhookUrl
 * @param {AlertContext} context
 * @returns {Promise<void>}
 */
async function sendDiscordAlert(webhookUrl, context) {
  const ssrfCheck = await validateUrlForSsrf(webhookUrl);
  if (!ssrfCheck.safe) {
    throw new Error(
      ERROR_MESSAGES.ALERT_URL_BLOCKED_BY_SSRF_POLICY(String(ssrfCheck.error)),
    );
  }
  /** @type {DiscordColor} */
  let color = DISCORD_COLORS.GREEN;
  if (context.error) {
    color = DISCORD_COLORS.RED;
  } else if (context.signatureValid === false) {
    color = DISCORD_COLORS.ORANGE;
  }

  let status = `Status: ${context.statusCode}`;
  if (context.error) {
    status = `Error: ${context.error}`;
  } else if (context.signatureValid === false) {
    status = `Signature Invalid: ${context.signatureError}`;
  }

  const payload = {
    embeds: [
      {
        title: "🔔 Webhook Alert",
        color,
        fields: [
          {
            name: "Webhook ID",
            value: `\`${context.webhookId}\``,
            inline: true,
          },
          { name: "Method", value: context.method, inline: true },
          { name: "Status", value: status, inline: false },
          { name: "Time", value: context.timestamp, inline: true },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  if (context.sourceIp) {
    payload.embeds[0].fields.push({
      name: "Source IP",
      value: context.sourceIp,
      inline: true,
    });
  }

  await axios.post(webhookUrl, payload, {
    timeout: ALERT_TIMEOUT_MS,
    headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
  });
}

/**
 * Trigger an alert if conditions are met.
 * This is the main entry point for the alerting system.
 * @param {AlertConfig | undefined} config
 * @param {AlertContext} context
 * @returns {Promise<void>}
 */
export async function triggerAlertIfNeeded(config, context) {
  if (!config) return;
  if (!config.slack?.webhookUrl && !config.discord?.webhookUrl) return;

  if (shouldAlert(config, context)) {
    await sendAlert(config, context);
  }
}
