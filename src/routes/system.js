/**
 * @file src/routes/system.js
 * @description System metrics route handler for monitoring sync status.
 * @module routes/system
 */
import { asyncHandler } from "./utils.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("../services/SyncService.js").SyncService} SyncService
 */

/**
 * Creates the system metrics route handler.
 * @param {SyncService} syncService
 * @returns {RequestHandler}
 */
export const createSystemMetricsHandler = (syncService) =>
  asyncHandler(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const syncMetrics = syncService.getMetrics();

      res.json({
        timestamp: new Date().toISOString(),
        sync: syncMetrics,
      });
    },
  );
