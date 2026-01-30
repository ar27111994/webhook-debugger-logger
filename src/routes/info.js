/**
 * @file src/routes/info.js
 * @description Info route handler providing system status and configuration details.
 * @module routes/info
 */

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
      status: "Enterprise Suite Online",
      system: {
        authActive: !!getAuthKey(),
        retentionHours: getRetentionHours(),
        maxPayloadLimit: `${((getMaxPayloadSize() || 0) / 1024 / 1024).toFixed(1)}MB`,
        webhookCount: activeWebhooks.length,
        activeWebhooks,
      },
      features: [
        "Advanced Mocking & Latency Control",
        "Enterprise Security (Auth/CIDR)",
        "Smart Forwarding Workflows",
        "Isomorphic Custom Scripting",
        "Real-time SSE Log Streaming",
        "High-Performance Logging",
      ],
      endpoints: {
        logs: `${baseUrl}/logs?limit=100`,
        stream: `${baseUrl}/log-stream`,
        webhook: `${baseUrl}/webhook/:id`,
        replay: `${baseUrl}/replay/:webhookId/:itemId?url=http://your-goal.com`,
        info: `${baseUrl}/info`,
      },
      docs: "https://apify.com/ar27111994/webhook-debugger-logger",
    });
  };
