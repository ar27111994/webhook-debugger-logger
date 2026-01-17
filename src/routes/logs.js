/**
 * Logs route handler module.
 * @module routes/logs
 */
import { Actor } from "apify";
import { asyncHandler } from "./utils.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("../webhook_manager.js").WebhookManager} WebhookManager
 */

/**
 * Creates the logs route handler.
 * @param {WebhookManager} webhookManager
 * @returns {RequestHandler}
 */
export const createLogsHandler = (webhookManager) =>
  asyncHandler(
    async (/** @param {Request} req @param {Response} res */ req, res) => {
      try {
        let {
          webhookId,
          method,
          statusCode,
          contentType,
          startTime,
          endTime,
          signatureValid,
          requestId,
          limit = 100,
          offset = 0,
        } = req.query;
        limit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 1000);
        offset = Math.max(parseInt(String(offset), 10) || 0, 0);

        // Parse timestamp filters
        const startDate = startTime ? new Date(String(startTime)) : null;
        const endDate = endTime ? new Date(String(endTime)) : null;
        const sigValid =
          signatureValid === "true"
            ? true
            : signatureValid === "false"
              ? false
              : undefined;

        const hasFilters = !!(
          webhookId ||
          method ||
          statusCode ||
          contentType ||
          startTime ||
          endTime ||
          signatureValid !== undefined ||
          requestId
        );
        const dataset = await Actor.openDataset();
        const result = await dataset.getData({
          limit: hasFilters ? limit * 5 : limit,
          offset,
          desc: true,
        });

        const filtered = (result.items || [])
          .filter((item) => {
            if (webhookId && item.webhookId !== webhookId) return false;
            if (
              method &&
              item.method?.toUpperCase() !== String(method).toUpperCase()
            )
              return false;
            if (statusCode && String(item.statusCode) !== String(statusCode))
              return false;
            if (
              contentType &&
              !item.headers?.["content-type"]?.includes(String(contentType))
            )
              return false;
            // Timestamp range filter
            if (startDate && !isNaN(startDate.getTime())) {
              const itemDate = new Date(item.timestamp);
              if (itemDate < startDate) return false;
            }
            if (endDate && !isNaN(endDate.getTime())) {
              const itemDate = new Date(item.timestamp);
              if (itemDate > endDate) return false;
            }
            // Signature status filter
            if (sigValid !== undefined && item.signatureValid !== sigValid)
              return false;
            // Request ID filter
            if (requestId && item.requestId !== requestId) return false;
            return webhookManager.isValid(item.webhookId);
          })
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );

        res.json({
          filters: {
            webhookId,
            method,
            statusCode,
            contentType,
            startTime,
            endTime,
            signatureValid,
            requestId,
          },
          count: Math.min(filtered.length, limit),
          total: filtered.length,
          items: filtered.slice(0, limit),
        });
        return;
      } catch (e) {
        res.status(500).json({
          error: "Logs failed",
          message: /** @type {Error} */ (e).message,
        });
      }
    },
  );
