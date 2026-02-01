import { describe, test, expect } from "@jest/globals";
import * as routes from "../../src/routes/index.js";

describe("Routes Index", () => {
  test("should export all required route handlers", () => {
    // Check for exports presence
    expect(routes.createBroadcaster).toBeDefined();
    expect(routes.createLogsHandler).toBeDefined();
    expect(routes.createLogDetailHandler).toBeDefined();
    expect(routes.createLogPayloadHandler).toBeDefined();
    expect(routes.createInfoHandler).toBeDefined();
    expect(routes.createLogStreamHandler).toBeDefined();
    expect(routes.createReplayHandler).toBeDefined();
    expect(routes.createDashboardHandler).toBeDefined();
    expect(routes.createSystemMetricsHandler).toBeDefined();
    expect(routes.createHealthRoutes).toBeDefined();

    // Check types
    expect(typeof routes.createBroadcaster).toBe("function");
    expect(typeof routes.createLogsHandler).toBe("function");
    expect(typeof routes.createLogDetailHandler).toBe("function");
    // ... others are verified by presence, smoke test ensures integrity
  });
});
