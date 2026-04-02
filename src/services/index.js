/**
 * @file src/services/index.js
 * @description Central export point for application services (Singleton pattern).
 * Ensures services like ForwardingService (which holds CircuitBreaker state) are shared across the app.
 * @module services
 */

import { ForwardingService } from "./ForwardingService.js";
import { SyncService } from "./SyncService.js";

// Singleton Instances
export const forwardingService = new ForwardingService();
export const syncService = new SyncService();

// Export Classes for testing/unique usage if needed
export { ForwardingService, SyncService };
