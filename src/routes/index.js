/**
 * @file src/routes/index.js
 * @description Route handlers index exporting all route factory functions.
 * @module routes
 */

export { escapeHtml, asyncHandler, createBroadcaster } from "./utils.js";
export {
  createLogsHandler,
  createLogDetailHandler,
  createLogPayloadHandler,
} from "./logs.js";
export { createInfoHandler } from "./info.js";
export { createLogStreamHandler } from "./stream.js";
export { createReplayHandler } from "./replay.js";
export { createDashboardHandler, preloadTemplate } from "./dashboard.js";
export { createSystemMetricsHandler } from "./system.js";
export { createHealthRoutes } from "./health.js";
