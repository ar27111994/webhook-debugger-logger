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

// Import module under test
const main = await import("../../src/main.js");
const { Actor } = await import("apify");
const { HotReloadManager } =
  await import("../../src/utils/hot_reload_manager.js");

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

  describe("server export", () => {
    test("should export express app", () => {
      expect(main.app).toBeDefined();
    });
  });
});
