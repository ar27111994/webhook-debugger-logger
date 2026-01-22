import axios from "axios";

/**
 * @typedef {import("../typedefs.js").AlertTrigger} AlertTrigger
 * @typedef {import("../typedefs.js").AlertChannel} AlertChannel
 * @typedef {import("../typedefs.js").AlertChannelConfig} AlertChannelConfig
 * @typedef {import("../typedefs.js").AlertConfig} AlertConfig
 * @typedef {import("../typedefs.js").AlertContext} AlertContext
 */

/**
 * @type {Readonly<AlertTrigger[]>}
 */
const DEFAULT_ALERT_ON = Object.freeze(["error", "5xx"]);
const ALERT_TIMEOUT_MS = 5000;

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
      case "error":
        if (context.error) return true;
        break;
      case "4xx":
        if (
          context.statusCode &&
          context.statusCode >= 400 &&
          context.statusCode < 500
        )
          return true;
        break;
      case "5xx":
        if (context.statusCode && context.statusCode >= 500) return true;
        break;
      case "timeout":
        if (context.error?.toLowerCase().includes("timeout")) return true;
        break;
      case "signature_invalid":
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
          console.error("[ALERT] Slack notification failed:", err.message);
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
          console.error("[ALERT] Discord notification failed:", err.message);
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
 */
async function sendSlackAlert(webhookUrl, context) {
  const emoji = context.error
    ? "🚨"
    : context.signatureValid === false
      ? "⚠️"
      : "📩";
  const status = context.error
    ? `Error: ${context.error}`
    : context.signatureValid === false
      ? `Signature Invalid: ${context.signatureError}`
      : `Status: ${context.statusCode}`;

  const payload = {
    blocks: /** @type {any[]} */ ([
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} Webhook Alert`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Webhook ID:*\n\`${context.webhookId}\`` },
          { type: "mrkdwn", text: `*Method:*\n${context.method}` },
          { type: "mrkdwn", text: `*Status:*\n${status}` },
          { type: "mrkdwn", text: `*Time:*\n${context.timestamp}` },
        ],
      },
    ]),
  };

  if (context.sourceIp) {
    payload.blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Source IP: ${context.sourceIp}` }],
    });
  }

  await axios.post(webhookUrl, payload, {
    timeout: ALERT_TIMEOUT_MS,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Sends a Discord webhook notification.
 * @param {string} webhookUrl
 * @param {AlertContext} context
 */
async function sendDiscordAlert(webhookUrl, context) {
  const color = context.error
    ? 0xff0000
    : context.signatureValid === false
      ? 0xffa500
      : 0x00ff00;
  const status = context.error
    ? `Error: ${context.error}`
    : context.signatureValid === false
      ? `Signature Invalid: ${context.signatureError}`
      : `Status: ${context.statusCode}`;

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
    headers: { "Content-Type": "application/json" },
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
