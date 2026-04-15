/**
 * @file src/consts/alerting.js
 * @description Constants for alerting system (Slack/Discord payloads, triggers).
 * @module consts/alerting
 */

import { createRequire } from "module";
import { APP_CONSTS } from "./app.js";

const require = createRequire(import.meta.url);
const inputSchema = require("../../.actor/input_schema.json");

export const ALERT_CHANNELS = Object.freeze({
  SLACK: "slack",
  DISCORD: "discord",
});

export const ALERT_TRIGGERS = Object.freeze({
  ERROR: "error",
  STATUS_4XX: "4xx",
  STATUS_5XX: "5xx",
  TIMEOUT: "timeout",
  SIGNATURE_INVALID: "signature_invalid",
});

export const SLACK_BLOCK_TYPES = Object.freeze({
  HEADER: "header",
  SECTION: "section",
  CONTEXT: "context",
  PLAIN_TEXT: "plain_text",
  MARKDOWN: "mrkdwn",
});

export const DISCORD_COLORS = Object.freeze({
  RED: 0xff0000,
  ORANGE: 0xffa500,
  GREEN: 0x00ff00,
});

export const DEFAULT_ALERT_ON = Object.freeze(
  inputSchema.properties.alertOn.default,
);
export const ALERT_TIMEOUT_MS = APP_CONSTS.ALERT_TIMEOUT_MS;
