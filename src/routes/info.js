/**
 * @file src/routes/info.js
 * @description Info route handler providing system status and configuration details.
 * @module routes/info
 */

import { APP_CONSTS } from "../consts/app.js";
import { DASHBOARD_CONSTS, UNIT_LABELS } from "../consts/ui.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("../webhook_manager.js").WebhookManager} WebhookManager
 */

/**
 * @typedef {Object} InfoDependencies
 * @property {WebhookManager} webhookManager
 * @property {() => string} getAuthKey
 * @property {() => number} getRetentionHours
 * @property {() => number | undefined} getMaxPayloadSize
 * @property {string} version
 */

/**
 * Creates the info route handler.
 * @param {InfoDependencies} deps
 * @returns {RequestHandler}
 */
export const createInfoHandler =
  (deps) => /** @param {Request} req @param {Response} res */ (req, res) => {
    const {
      webhookManager,
      getAuthKey,
      getRetentionHours,
      getMaxPayloadSize,
      version,
    } = deps;
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const activeWebhooks = webhookManager.getAllActive();

    res.json({
      version,
      status: DASHBOARD_CONSTS.INFO_STATUS,
      system: {
        authActive: !!getAuthKey(),
        retentionHours: getRetentionHours(),
        maxPayloadLimit: `${(
          (getMaxPayloadSize() || 0) /
          APP_CONSTS.BYTES_PER_KB /
          APP_CONSTS.BYTES_PER_KB
        ).toFixed(1)}${UNIT_LABELS.MB}`,
        webhookCount: activeWebhooks.length,
        activeWebhooks,
      },
      features: DASHBOARD_CONSTS.FEATURES_LIST,
      endpoints: {
        logs: `${baseUrl}${DASHBOARD_CONSTS.ENDPOINTS.LOGS}`,
        stream: `${baseUrl}${DASHBOARD_CONSTS.ENDPOINTS.STREAM}`,
        webhook: `${baseUrl}${DASHBOARD_CONSTS.ENDPOINTS.WEBHOOK}`,
        replay: `${baseUrl}${DASHBOARD_CONSTS.ENDPOINTS.REPLAY}`,
        info: `${baseUrl}${DASHBOARD_CONSTS.ENDPOINTS.INFO}`,
      },
      docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
    });
  };
