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

export const DASHBOARD_PLACEHOLDERS = Object.freeze({
  VERSION: "{{VERSION}}",
  ACTIVE_COUNT: "{{ACTIVE_COUNT}}",
  SIGNATURE_BADGE: "{{SIGNATURE_BADGE}}",
  BRAND_HEADER: "{{BRAND_HEADER}}",
});

export const DASHBOARD_CONSTS = Object.freeze({
  BRAND_HEADER: actorJson.title,
  INFO_STATUS: "Enterprise Suite Online",
  FEATURES_LIST: [
    "Advanced Mocking & Latency Control",
    "Enterprise Security (Auth/CIDR)",
    "Smart Forwarding Workflows",
    "Isomorphic Custom Scripting",
    "Real-time SSE Log Streaming",
    "High-Performance Logging",
  ],
  ENDPOINTS: Object.freeze({
    LOGS: `${APP_ROUTES.LOGS}?limit=${PAGINATION_CONSTS.DEFAULT_PAGE_LIMIT}`,
    STREAM: APP_ROUTES.LOG_STREAM,
    WEBHOOK: APP_ROUTES.WEBHOOK,
    REPLAY: `${APP_ROUTES.REPLAY}?url=http://your-goal.com`,
    INFO: APP_ROUTES.INFO,
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
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8f9fa; color: #333; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
        h1 { color: #dc3545; margin-top: 0; }
        p { line-height: 1.5; color: #666; }
        .btn { display: inline-block; padding: 0.5rem 1rem; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin-top: 1rem; }
        .btn:hover { background: #0056b3; }
    </style>
</head>
<body>
    <div class="container">
        <h1>401 Unauthorized</h1>
        <p>{{ERROR_MESSAGE}}</p>
        <p>Please check your API key and try again. (Strict Mode)</p>
        <a href="{{APIFY_HOMEPAGE_URL}}" class="btn">Learn More</a>
    </div>
</body>
</html>
`;
