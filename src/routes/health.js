/**
 * @file src/routes/health.js
 * @description Health check endpoints for monitoring and orchestration.
 * Provides /health and /ready endpoints for container health probes.
 * @module routes/health
 */
import { getDbInstance } from "../db/duckdb.js";
import { HTTP_STATUS } from "../consts/http.js";
import { STATUS_LABELS, UNIT_LABELS } from "../consts/ui.js";
import { ERROR_MESSAGES } from "../consts/errors.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { APP_CONSTS } from "../consts/app.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').Router} Router
 */

/**
 * Health check response structure.
 * @typedef {Object} HealthResponse
 * @property {'healthy' | 'unhealthy'} status - Overall health status
 * @property {number} uptime - Process uptime in seconds
 * @property {string} timestamp - ISO timestamp
 * @property {Object} checks - Individual component checks
 */

const startTime = Date.now();

/**
 * Creates health check route handlers.
 * @param {() => number} getActiveWebhookCount - Function to get active webhook count
 * @returns {{ health: (req: Request, res: Response) => Promise<void>, ready: (req: Request, res: Response) => Promise<void> }}
 */
export function createHealthRoutes(getActiveWebhookCount) {
  /**
   * GET /health
   * Liveness probe - checks if the process is running.
   * Returns 200 if alive, used by container orchestrators.
   */
  const health =
    /**
     * @param {Request} _req
     * @param {Response} res
     */
    async (_req, res) => {
      const uptime = Math.floor(
        (Date.now() - startTime) / APP_CONSTS.MS_PER_SECOND,
      );
      const memoryUsage = process.memoryUsage();

      res.json({
        status: STATUS_LABELS.HEALTHY,
        uptime,
        timestamp: new Date().toISOString(),
        memory: {
          heapUsed: Math.round(
            memoryUsage.heapUsed /
              APP_CONSTS.BYTES_PER_KB /
              APP_CONSTS.BYTES_PER_KB,
          ),
          heapTotal: Math.round(
            memoryUsage.heapTotal /
              APP_CONSTS.BYTES_PER_KB /
              APP_CONSTS.BYTES_PER_KB,
          ),
          rss: Math.round(
            memoryUsage.rss / APP_CONSTS.BYTES_PER_KB / APP_CONSTS.BYTES_PER_KB,
          ),
          unit: UNIT_LABELS.MB,
        },
      });
    };

  /**
   * GET /ready
   * Readiness probe - checks if the service is ready to accept traffic.
   * Validates database connectivity and webhook state.
   */
  const ready =
    /**
     * @param {Request} _req
     * @param {Response} res
     */
    async (_req, res) => {
      /** @type {Record<string, { status: string, message?: string }>} */
      const checks = {};
      let allHealthy = true;

      // Check DuckDB connectivity
      try {
        const db = await getDbInstance();
        if (db) {
          checks.database = { status: STATUS_LABELS.OK };
        } else {
          checks.database = {
            status: STATUS_LABELS.ERROR,
            message: ERROR_MESSAGES.DB_NOT_INITIALIZED,
          };
          allHealthy = false;
        }
      } catch (err) {
        checks.database = {
          status: STATUS_LABELS.ERROR,
          message:
            err instanceof Error ? err.message : LOG_MESSAGES.UNKNOWN_ERROR,
        };
        allHealthy = false;
      }

      // Check webhook state
      try {
        const webhookCount = getActiveWebhookCount();
        checks.webhooks = {
          status: STATUS_LABELS.OK,
          message: `${webhookCount} active webhook(s)`,
        };
      } catch (err) {
        checks.webhooks = {
          status: STATUS_LABELS.ERROR,
          message:
            err instanceof Error ? err.message : LOG_MESSAGES.UNKNOWN_ERROR,
        };
        allHealthy = false;
      }

      const status = allHealthy
        ? HTTP_STATUS.OK
        : HTTP_STATUS.SERVICE_UNAVAILABLE;
      res.status(status).json({
        status: allHealthy ? STATUS_LABELS.READY : STATUS_LABELS.NOT_READY,
        timestamp: new Date().toISOString(),
        checks,
      });
    };

  return { health, ready };
}
