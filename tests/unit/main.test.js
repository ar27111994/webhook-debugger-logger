import { jest, describe, test, expect } from "@jest/globals";
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { INPUT_POLL_INTERVAL_TEST_MS } from "../../src/consts.js";

// 1. Setup Common Mocks
await setupCommonMocks({
  apify: true,
  logger: true,
  express: true,
  db: true,
  sync: true,
  loggerMiddleware: true,
  appState: true,
  hotReload: true,
  bootstrap: true,
  routes: true,
  middleware: true,
  consts: true,
  webhookManager: true,
});

import {
  expressAppMock,
  syncServiceMock,
  hotReloadManagerMock,
  bootstrapMock,
  webhookManagerMock,
} from "../setup/helpers/shared-mocks.js";
import { assertType } from "../setup/helpers/test-utils.js";

// Import module under test
const main = await import("../../src/main.js");
const { Actor } = await import("apify");
const { HotReloadManager } =
  await import("../../src/utils/hot_reload_manager.js");

/**
 * @typedef {import("http").ServerResponse} ServerResponse
 */

describe("Main Entry Point", () => {
  useMockCleanup();

  describe("initialize()", () => {
    test("should initialize basic components and start server", async () => {
      await main.initialize();

      expect(Actor.init).toHaveBeenCalled();
      expect(webhookManagerMock.init).toHaveBeenCalled();
      expect(syncServiceMock.start).toHaveBeenCalled();
      expect(hotReloadManagerMock.init).toHaveBeenCalled();
      expect(hotReloadManagerMock.start).toHaveBeenCalled();
      expect(expressAppMock.listen).not.toHaveBeenCalled(); // Server start is guarded by NODE_ENV !== test

      // Verify HotReloadManager was initialized with correct polling interval
      expect(HotReloadManager).toHaveBeenCalledWith(
        expect.objectContaining({
          pollIntervalMs: INPUT_POLL_INTERVAL_TEST_MS,
        }),
      );
    });

    test("should handle local input bootstrapping when not at home", async () => {
      jest.mocked(Actor.isAtHome).mockReturnValue(false);
      jest.mocked(Actor.getInput).mockResolvedValue({ some: "input" });

      await main.initialize();

      expect(bootstrapMock.ensureLocalInputExists).toHaveBeenCalledWith({
        some: "input",
      });
    });

    test("should override input from process.env.INPUT if present", async () => {
      jest.mocked(Actor.isAtHome).mockReturnValue(false);
      const originalEnvInput = process.env.INPUT;
      process.env.INPUT = JSON.stringify({ overridden: true });

      await main.initialize();

      expect(jest.mocked(main.webhookManager.init)).toHaveBeenCalled();

      // Cleanup
      if (originalEnvInput) process.env.INPUT = originalEnvInput;
      else delete process.env.INPUT;
    });

    test("should scale up webhooks if fewer than requested", async () => {
      jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
      // config mock returns empty defaults, but we pass options to initialize
      const urlCount = 5;
      const retentionHours = 24;
      await main.initialize({ urlCount, retentionHours });

      expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(
        urlCount,
        retentionHours,
      );
    });

    test("should not scale if active count matches requested", async () => {
      const urlCount = 5;
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue(new Array(urlCount).fill({}));
      await main.initialize({ urlCount });

      expect(webhookManagerMock.generateWebhooks).not.toHaveBeenCalled();
    });

    test("should sync retention hours", async () => {
      const retentionHours = 48;
      await main.initialize({ retentionHours });
      expect(webhookManagerMock.updateRetention).toHaveBeenCalledWith(
        retentionHours,
      );
    });

    test("should handle DB init failure gracefully (Disposable Read Model)", async () => {
      const { getDbInstance } = await import("../../src/db/duckdb.js");
      jest.mocked(getDbInstance).mockRejectedValueOnce(new Error("DB Down"));

      await main.initialize();

      // Should not throw
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.anything(),
        }),
        "Failed to initialize DuckDB or SyncService",
      );
    });
  });

  test("should log warning on invalid JSON in INPUT env var", async () => {
    jest.mocked(Actor.isAtHome).mockReturnValue(false);
    const originalEnvInput = process.env.INPUT;
    process.env.INPUT = "{ invalid json }";

    await main.initialize();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Object),
      }),
      "Failed to parse INPUT env var",
    );

    // Cleanup
    if (originalEnvInput) process.env.INPUT = originalEnvInput;
    else delete process.env.INPUT;
  });

  test("should throw and log on Array input in INPUT env var", async () => {
    jest.mocked(Actor.isAtHome).mockReturnValue(false);
    const originalEnvInput = process.env.INPUT;
    process.env.INPUT = JSON.stringify([{ key: "value" }]);

    await main.initialize();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: "INPUT env var must be a non-array JSON object",
        }),
      }),
      "Failed to parse INPUT env var",
    );

    // Cleanup
    if (originalEnvInput) process.env.INPUT = originalEnvInput;
    else delete process.env.INPUT;
  });

  describe("shutdown()", () => {
    /** @type {string | undefined} */
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test("should cleanup components on shutdown", async () => {
      await main.shutdown("TEST_COMPLETE");

      expect(hotReloadManagerMock.stop).toHaveBeenCalled();
      expect(syncServiceMock.stop).toHaveBeenCalled();
      expect(webhookManagerMock.persist).toHaveBeenCalled();
      expect(Actor.exit).toHaveBeenCalled();
    });

    test("should not exit process if in test mode (default)", async () => {
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation(() => assertType(undefined));
      await main.shutdown("SIGTERM");
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    test("should exit process if not in test mode", async () => {
      process.env.NODE_ENV = "production";
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((_code) => {
          throw new Error("Process Exited");
        });

      try {
        await main.shutdown("SIGINT");
      } catch (e) {
        expect(/** @type {Error} */ (e).message).toBe("Process Exited");
      }

      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });
  });

  describe("server export", () => {
    test("should export express app", () => {
      expect(main.app).toBeDefined();
    });
  });

  describe("SSE Heartbeat", () => {
    test("should remove dead clients on heartbeat error", async () => {
      jest.useFakeTimers();
      const { createLogStreamHandler } =
        await import("../../src/routes/index.js");

      // Helper to capture the set
      /** @type {Set<ServerResponse>} */
      let capturedClients = new Set();
      jest.mocked(createLogStreamHandler).mockImplementation(
        /** @param {Set<ServerResponse>} clients */
        (clients) => {
          capturedClients = clients;
          return jest.fn();
        },
      );

      // Re-initialize to trigger createLogStreamHandler
      await main.initialize();

      expect(capturedClients).toBeDefined();

      /** @type {ServerResponse} */
      const mockClient = assertType({
        write: jest.fn().mockImplementation(() => {
          throw new Error("Closed");
        }),
      });
      if (capturedClients) {
        capturedClients.add(mockClient);
      }

      jest.advanceTimersByTime(110); // > 100ms interval

      expect(mockClient.write).toHaveBeenCalled();
      if (capturedClients) expect(capturedClients.has(mockClient)).toBe(false);

      jest.useRealTimers();
    });
  });

  describe("Health Check Callback", () => {
    test("should export health callback that checks webhook count", async () => {
      const { createHealthRoutes } = await import("../../src/routes/index.js");
      /** @typedef {() => number} HealthCallback */
      /** @type {HealthCallback | null} */
      let capturedCb = null;

      jest.mocked(createHealthRoutes).mockImplementation(
        /** @param {HealthCallback} cb */
        (cb) => {
          capturedCb = cb;
          return assertType({ health: jest.fn(), ready: jest.fn() });
        },
      );

      await main.initialize();

      expect(capturedCb).toBeDefined();
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue([
          assertType({ id: "1" }),
          assertType({ id: "2" }),
          assertType({ id: "3" }),
        ]);

      if (capturedCb) {
        expect(/** @type {HealthCallback} */ (capturedCb)?.()).toBe(3);
      }
    });
  });
});
