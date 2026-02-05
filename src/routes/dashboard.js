/**
 * @file src/routes/dashboard.js
 * @description Dashboard route handler providing HTML landing page and status display.
 * @module routes/dashboard
 */
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createChildLogger, serializeError } from "../utils/logger.js";
import {
  HTTP_STATUS,
  MIME_TYPES,
  DASHBOARD_PLACEHOLDERS,
  DASHBOARD_TEMPLATE_PATH,
} from "../consts.js";

const log = createChildLogger({ component: "Dashboard" });

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("../webhook_manager.js").WebhookManager} WebhookManager
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {Object} DashboardDependencies
 * @property {WebhookManager} webhookManager
 * @property {string} version
 * @property {() => string} getTemplate - Function to get cached template
 * @property {(template: string) => void} setTemplate - Function to cache template
 * @property {() => string|null} getSignatureStatus - Function to get current signature provider
 */

/**
 * Creates the dashboard (root) route handler.
 * @param {DashboardDependencies} deps
 * @returns {RequestHandler}
 */
export const createDashboardHandler =
  (deps) =>
  /** @param {Request} req @param {Response} res */
  async (req, res) => {
    const {
      webhookManager,
      version,
      getTemplate,
      setTemplate,
      getSignatureStatus,
    } = deps;

    const activeCount = webhookManager.getAllActive().length;
    const signatureProvider = getSignatureStatus ? getSignatureStatus() : null;

    if (req.headers["accept"]?.includes(MIME_TYPES.PLAIN)) {
      return res
        .type(MIME_TYPES.PLAIN)
        .send(
          `Webhook Debugger & Logger - Enterprise Suite (v${version})\n` +
            `Active Webhooks: ${activeCount}\n` +
            `Signature Verification: ${signatureProvider || "Disabled"}`,
        );
    }

    try {
      let template = getTemplate();
      if (!template) {
        template = await readFile(
          join(__dirname, "..", "..", DASHBOARD_TEMPLATE_PATH),
          "utf-8",
        );
        setTemplate(template);
      }

      const sigBadge = signatureProvider
        ? `<div class="status-badge signature-active">🔒 Verified: ${signatureProvider}</div>`
        : `<div class="status-badge signature-inactive">🔓 No Verification</div>`;

      const html = template
        .replaceAll(DASHBOARD_PLACEHOLDERS.VERSION, `v${version}`)
        .replaceAll(DASHBOARD_PLACEHOLDERS.ACTIVE_COUNT, String(activeCount))
        .replaceAll(DASHBOARD_PLACEHOLDERS.SIGNATURE_BADGE, sigBadge);

      res.send(html);
    } catch (err) {
      log.error({ err: serializeError(err) }, "Failed to load index.html");
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send("Internal Server Error");
    }
  };

/**
 * Preloads the index.html template.
 * @returns {Promise<string>}
 */
export const preloadTemplate = async () => {
  try {
    return await readFile(
      join(__dirname, "..", "..", DASHBOARD_TEMPLATE_PATH),
      "utf-8",
    );
  } catch (err) {
    log.warn({ err: serializeError(err) }, "Failed to preload index.html");
    return "";
  }
};
