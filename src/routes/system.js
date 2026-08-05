/**
 * @file src/routes/system.js
 * @description System metrics route handler for monitoring sync status.
 * @module routes/system
 */
import { asyncHandler } from "./utils.js";
import { LATENCY_BUDGETS } from "../consts/app.js";
import { logRepository } from "../repositories/LogRepository.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("../services/SyncService.js").SyncService} SyncService
 * @typedef {import("../repositories/LogRepository.js").LogRepository} LogRepository
 */

/**
 * Creates the system metrics route handler.
 * @param {SyncService} syncService
 * @param {LogRepository} [metricsRepository]
 * @returns {RequestHandler}
 */
export const createSystemMetricsHandler = (
  syncService,
  metricsRepository = logRepository,
) =>
  asyncHandler(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => {
      const syncMetrics = syncService.getMetrics();
      const latencyMetrics = await metricsRepository.getLatencyMetrics();

      res.json({
        timestamp: new Date().toISOString(),
        sync: syncMetrics,
        latency: latencyMetrics,
        latencyBudgets: LATENCY_BUDGETS,
      });
    },
  );
