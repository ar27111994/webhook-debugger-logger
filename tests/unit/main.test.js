import { jest, describe, test, expect } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

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
  webhookManager: true,
});

import {
  ENV_VARS,
  SHUTDOWN_SIGNALS,
  APP_CONSTS,
  ENV_VALUES,
} from "../../src/consts/app.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";

import {
  constsMock,
  expressAppMock,
  syncServiceMock,
  hotReloadManagerMock,
  bootstrapMock,
  webhookManagerMock,
  loggerMock,
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
          pollIntervalMs: constsMock.INPUT_POLL_INTERVAL_TEST_MS,
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
      const originalEnvInput = process.env[ENV_VARS.INPUT];
      process.env[ENV_VARS.INPUT] = JSON.stringify({ overridden: true });

      await main.initialize();

      expect(webhookManagerMock.init).toHaveBeenCalled();

      // Cleanup
      if (originalEnvInput) process.env[ENV_VARS.INPUT] = originalEnvInput;
      else delete process.env[ENV_VARS.INPUT];
    });

    test("should scale up webhooks if fewer than requested", async () => {
      jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
      // config mock returns empty defaults, but we pass options to initialize
      const urlCount = 5;
      const retentionHours = APP_CONSTS.DEFAULT_RETENTION_HOURS;
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
      const RETENTION_MULTIPLIER = 2;
      const retentionHours =
        APP_CONSTS.DEFAULT_RETENTION_HOURS * RETENTION_MULTIPLIER;
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
        LOG_MESSAGES.INIT_DB_SYNC_FAILED,
      );
    });
  });

  test("should log warning on invalid JSON in INPUT env var", async () => {
    jest.mocked(Actor.isAtHome).mockReturnValue(false);
    const originalEnvInput = process.env[ENV_VARS.INPUT];
    process.env[ENV_VARS.INPUT] = "{ invalid json }";

    await main.initialize();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Object),
      }),
      LOG_MESSAGES.INPUT_ENV_VAR_PARSE_FAILED,
    );

    // Cleanup
    if (originalEnvInput) process.env[ENV_VARS.INPUT] = originalEnvInput;
    else delete process.env[ENV_VARS.INPUT];
  });

  test("should throw and log on Array input in INPUT env var", async () => {
    jest.mocked(Actor.isAtHome).mockReturnValue(false);
    const originalEnvInput = process.env[ENV_VARS.INPUT];
    process.env[ENV_VARS.INPUT] = JSON.stringify([{ key: "value" }]);

    await main.initialize();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: LOG_MESSAGES.INPUT_ENV_VAR_INVALID,
        }),
      }),
      LOG_MESSAGES.INPUT_ENV_VAR_PARSE_FAILED,
    );

    // Cleanup
    if (originalEnvInput) process.env[ENV_VARS.INPUT] = originalEnvInput;
    else delete process.env[ENV_VARS.INPUT];
  });

  describe("shutdown()", () => {
    /** @type {string | undefined} */
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env[ENV_VARS.NODE_ENV];
    });

    afterEach(() => {
      process.env[ENV_VARS.NODE_ENV] = originalEnv;
    });

    test("should cleanup components on shutdown", async () => {
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation(() => assertType(undefined));
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
      await main.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);

      expect(hotReloadManagerMock.stop).toHaveBeenCalled();
      expect(syncServiceMock.stop).toHaveBeenCalled();
      expect(webhookManagerMock.persist).toHaveBeenCalled();
      expect(Actor.exit).toHaveBeenCalled(); // Called without args in main.js
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });

    test("should log warning if startup event push fails", async () => {
      // Mock successful run but pushData failure
      jest.mocked(Actor.pushData).mockRejectedValue(new Error("Push Failed"));
      jest.mocked(Actor.isAtHome).mockReturnValue(true);
      process.env.APIFY_IS_AT_HOME = "true";
      const exitError = "EXIT_0";

      // Force logic to run (skip "test" guard)
      const oldEnv = process.env[ENV_VARS.NODE_ENV];
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;

      // Prevent exit so we can assert
      jest.spyOn(Actor, "exit").mockImplementation(async () => {
        throw new Error(exitError);
      });

      try {
        await main.initialize();
      } catch (e) {
        if (!(/** @type {Error} */ (e).message.includes(exitError))) throw e;
      }

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.STARTUP_LOG_FAILED,
      );

      // Cleanup
      process.env[ENV_VARS.NODE_ENV] = oldEnv;
    });

    test("should not exit process if in test mode (default)", async () => {
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation(() => assertType(undefined));

      // Ensure Actor.exit resolves (restoring from previous test override)
      jest.spyOn(Actor, "exit").mockResolvedValue(undefined);

      await main.shutdown(SHUTDOWN_SIGNALS.SIGTERM);
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    test("should exit process if not in test mode", async () => {
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;

      // FIX LEAK: Override Actor.exit to resolve, masking previous test's throw
      jest.spyOn(Actor, "exit").mockResolvedValue(undefined);

      const exitError = "Process Exited";
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((_code) => {
          throw new Error(exitError);
        });

      try {
        await main.shutdown(SHUTDOWN_SIGNALS.SIGINT);
      } catch (e) {
        expect(/** @type {Error} */(e).message).toBe(exitError);
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

      const HEARTBEAT_OFFSET_MS = 5000;
      const HEARTBEAT_TIMEOUT_MS =
        APP_CONSTS.SSE_HEARTBEAT_INTERVAL_MS + HEARTBEAT_OFFSET_MS;
      jest.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS); // > interval

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
      const MOCK_WEBHOOK_COUNT = 3;
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue([
          assertType({ id: "1" }),
          assertType({ id: "2" }),
          assertType({ id: "3" }),
        ]);

      if (capturedCb) {
        expect(/** @type {HealthCallback} */(capturedCb)?.()).toBe(
          MOCK_WEBHOOK_COUNT,
        );
      }
    });
  });
});
