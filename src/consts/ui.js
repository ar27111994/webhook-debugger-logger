/**
 * @file src/consts/ui.js
 * @description UI and Dashboard related constants.
 * @module consts/ui
 */

import { createRequire } from "module";
import { APP_ROUTES } from "./app.js";
import { PAGINATION_CONSTS } from "./database.js";

const require = createRequire(import.meta.url);
const actorJson = require("../../.actor/actor.json");

export const DASHBOARD_TEMPLATE_PATH = "public/index.html";
export const UNAUTHORIZED_STYLESHEET_PATH = "/unauthorized.css";

export const DASHBOARD_PLACEHOLDERS = Object.freeze({
  VERSION: "{{VERSION}}",
  ACTIVE_COUNT: "{{ACTIVE_COUNT}}",
  SIGNATURE_BADGE_CLASS: "{{SIGNATURE_BADGE_CLASS}}",
  SIGNATURE_BADGE_LABEL: "{{SIGNATURE_BADGE_LABEL}}",
  BRAND_HEADER: "{{BRAND_HEADER}}",
});

export const DASHBOARD_CONSTS = Object.freeze({
  BRAND_HEADER: actorJson.title,
  INFO_STATUS: "Enterprise Suite Online",
  FEATURES_LIST: [
    "High-Performance Logging & Payload Forensics",
    "Real-time SSE Log Streaming",
    "Smart Forwarding & Replay Workflows",
    "Isomorphic Custom Scripting & Latency Simulation",
    "Provider Signature Verification & Enterprise Security",
    "Large Payload Handling & Operational Health",
  ],
  ENDPOINTS: Object.freeze({
    LOGS: `${APP_ROUTES.LOGS}?limit=${PAGINATION_CONSTS.DEFAULT_PAGE_LIMIT}`,
    LOG_DETAIL: APP_ROUTES.LOG_DETAIL,
    LOG_PAYLOAD: APP_ROUTES.LOG_PAYLOAD,
    STREAM: APP_ROUTES.LOG_STREAM,
    WEBHOOK: APP_ROUTES.WEBHOOK,
    REPLAY: `${APP_ROUTES.REPLAY}?url=http://your-goal.com`,
    INFO: APP_ROUTES.INFO,
    SYSTEM_METRICS: APP_ROUTES.SYSTEM_METRICS,
    HEALTH: APP_ROUTES.HEALTH,
    READY: APP_ROUTES.READY,
  }),
});

/** @enum {string} */
export const STATUS_LABELS = Object.freeze({
  HEALTHY: "healthy",
  OK: "ok",
  READY: "ready",
  NOT_READY: "not_ready",
  ERROR: "error",
  DISABLED: "Disabled",
  NO_VERIFICATION: "No Verification",
});

/** @enum {string} */
export const UNIT_LABELS = Object.freeze({
  MB: "MB",
});

/** @enum {string} */
export const SSE_CONSTS = Object.freeze({
  CONNECTED_MESSAGE: ": connected\n\n",
  DATA_PREFIX: "data: ",
  PADDING_LENGTH: 2048,
  HEARTBEAT_MESSAGE: ": heartbeat\n\n",
});

export const UNAUTHORIZED_HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
    <title>401 Unauthorized</title>
  <link rel="stylesheet" href="${UNAUTHORIZED_STYLESHEET_PATH}">
</head>
<body class="unauthorized-page">
  <div class="unauthorized-card">
        <h1>401 Unauthorized</h1>
        <p>{{ESCAPED_ERROR_MESSAGE}}</p>
        <p>Please check your API key and try again. (Strict Mode)</p>
    <a href="{{APIFY_HOMEPAGE_URL}}" class="unauthorized-link">Learn More</a>
    </div>
</body>
</html>
`;
