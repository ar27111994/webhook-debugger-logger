/**
 * @file src/routes/health.js
 * @description Health check endpoints for monitoring and orchestration.
 * Provides /health and /ready endpoints for container health probes.
 */
import { getDbInstance } from "../db/duckdb.js";

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
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const memoryUsage = process.memoryUsage();

      res.json({
        status: "healthy",
        uptime,
        timestamp: new Date().toISOString(),
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          unit: "MB",
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
      /** @type {Record<string, { status: 'ok' | 'error', message?: string }>} */
      const checks = {};
      let allHealthy = true;

      // Check DuckDB connectivity
      try {
        const db = await getDbInstance();
        if (db) {
          checks.database = { status: "ok" };
        } else {
          checks.database = {
            status: "error",
            message: "Database not initialized",
          };
          allHealthy = false;
        }
      } catch (err) {
        checks.database = {
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        };
        allHealthy = false;
      }

      // Check webhook state
      try {
        const webhookCount = getActiveWebhookCount();
        checks.webhooks = {
          status: "ok",
          message: `${webhookCount} active webhook(s)`,
        };
      } catch (err) {
        checks.webhooks = {
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        };
        allHealthy = false;
      }

      const status = allHealthy ? 200 : 503;
      res.status(status).json({
        status: allHealthy ? "ready" : "not_ready",
        timestamp: new Date().toISOString(),
        checks,
      });
    };

  return { health, ready };
}
