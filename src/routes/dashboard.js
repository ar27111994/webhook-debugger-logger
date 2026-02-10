/**
 * @file src/routes/dashboard.js
 * @description Dashboard route handler providing HTML landing page and status display.
 * @module routes/dashboard
 */
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { escapeHtml } from "./utils.js";
import { createChildLogger, serializeError } from "../utils/logger.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import {
  HTTP_STATUS,
  MIME_TYPES,
  HTTP_HEADERS,
  HTTP_STATUS_MESSAGES,
  ENCODINGS,
} from "../consts/http.js";
import {
  DASHBOARD_PLACEHOLDERS,
  DASHBOARD_TEMPLATE_PATH,
  DASHBOARD_CONSTS,
  STATUS_LABELS,
} from "../consts/ui.js";
import { LOG_COMPONENTS } from "../consts/logging.js";

const log = createChildLogger({ component: LOG_COMPONENTS.DASHBOARD });

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

    if (req.headers[HTTP_HEADERS.ACCEPT]?.includes(MIME_TYPES.PLAIN)) {
      return res
        .type(MIME_TYPES.PLAIN)
        .send(
          `${DASHBOARD_CONSTS.BRAND_HEADER} (v${version})\n` +
            `Active Webhooks: ${activeCount}\n` +
            `Signature Verification: ${signatureProvider || STATUS_LABELS.DISABLED}`,
        );
    }

    try {
      let template = getTemplate();
      if (!template) {
        template = await readFile(
          join(__dirname, "..", "..", DASHBOARD_TEMPLATE_PATH),
          ENCODINGS.UTF8,
        );
        setTemplate(template);
      }

      const escapedProvider = signatureProvider
        ? escapeHtml(signatureProvider)
        : null;
      const sigBadge = escapedProvider
        ? `<div class="status-badge signature-active">🔒 Verified: ${escapedProvider}</div>`
        : `<div class="status-badge signature-inactive">🔓 ${STATUS_LABELS.NO_VERIFICATION}</div>`;

      const html = template
        .replaceAll(DASHBOARD_PLACEHOLDERS.VERSION, `v${version}`)
        .replaceAll(DASHBOARD_PLACEHOLDERS.ACTIVE_COUNT, String(activeCount))
        .replaceAll(DASHBOARD_PLACEHOLDERS.SIGNATURE_BADGE, sigBadge);

      res.send(html);
    } catch (err) {
      log.error(
        { err: serializeError(err) },
        LOG_MESSAGES.DASHBOARD_LOAD_FAILED,
      );
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .send(HTTP_STATUS_MESSAGES[HTTP_STATUS.INTERNAL_SERVER_ERROR]);
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
      ENCODINGS.UTF8,
    );
  } catch (err) {
    log.warn(
      { err: serializeError(err) },
      LOG_MESSAGES.DASHBOARD_PRELOAD_FAILED,
    );
    return "";
  }
};
