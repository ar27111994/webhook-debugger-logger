/**
 * Dashboard route handler module.
 * @module routes/dashboard
 */
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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
    const { webhookManager, version, getTemplate, setTemplate } = deps;

    if (req.headers["accept"]?.includes("text/plain")) {
      return res.send("Webhook Debugger & Logger - Enterprise Suite");
    }

    try {
      let template = getTemplate();
      if (!template) {
        template = await readFile(
          join(__dirname, "..", "..", "public", "index.html"),
          "utf-8",
        );
        setTemplate(template);
      }
      const activeCount = webhookManager.getAllActive().length;
      const html = template
        .replaceAll("{{VERSION}}", `v${version}`)
        .replaceAll("{{ACTIVE_COUNT}}", String(activeCount));

      res.send(html);
    } catch (err) {
      console.error("[SERVER-ERROR] Failed to load index.html:", err);
      res.status(500).send("Internal Server Error");
    }
  };

/**
 * Preloads the index.html template.
 * @returns {Promise<string>}
 */
export const preloadTemplate = async () => {
  try {
    return await readFile(
      join(__dirname, "..", "..", "public", "index.html"),
      "utf-8",
    );
  } catch (err) {
    console.warn("Failed to preload index.html:", err);
    return "";
  }
};
