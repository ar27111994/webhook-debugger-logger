/**
 * @file tests/unit/main.test.js
 * @description Unit tests for the main entry point and application lifecycle.
 *
 * Test structure:
 *  - Module Bootstrap       : top-level evaluation, APP_VERSION resolution
 *  - initialize()           : orchestration, scaling, env parsing, re-entrancy
 *  - shutdown()             : graceful sequence, force-exit timeout, pre-init safety
 *  - Shutdown Resilience    : partial failures anywhere in the cleanup chain
 *  - Global Event Handlers  : signal registration, retry logic, deduplication
 *  - SSE Heartbeat          : interval behavior, client eviction, unref safety, drain
 *  - Middleware & Route Callbacks : anonymous closures passed to factories
 *  - Production Lifecycle   : listen, cleanup interval, testAndExit, pushData errors
 */
import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  assertType,
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
  flushPromises,
} from "../setup/helpers/test-utils.js";
import {
  useFakeTimers,
  useMockCleanup,
} from "../setup/helpers/test-lifecycle.js";

/**
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("../../src/routes/dashboard.js").DashboardDependencies} DashboardDependencies
 * @typedef {import("../../src/routes/info.js").InfoDependencies} InfoDependencies
 * @typedef {import("../../src/typedefs.js").CustomRequest} CustomRequest
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("compression").CompressionOptions} CompressionOptions
 * @typedef {import("compression").CompressionFilter} CompressionFilter
 * @typedef {import("http").Server} Server
 * @typedef {import("fs").PathOrFileDescriptor} PathOrFileDescriptor
 * @typedef {import("../../src/typedefs.js").WebhookData} WebhookData
 * @typedef {import("../../src/main.js")} Main
 */

await setupCommonMocks({
  apify: true,
  db: true,
  sync: true,
  loggerMiddleware: true,
  appState: true,
  hotReload: true,
  bootstrap: true,
  routes: true,
  middleware: true,
  webhookManager: true,
  logger: true,
  express: true,
  consts: true,
  system: true,
  commonUtils: true,
  fs: true,
});

const {
  apifyMock,
  duckDbMock,
  syncServiceMock,
  webhookManagerMock,
  hotReloadManagerMock: hotReloadMock,
  bootstrapMock,
  routesMock,
  middlewareFactoriesMock: middlewareMock,
  appStateMock,
  loggerMock,
  expressAppMock,
  expressMock,
  constsMock,
  systemMock,
  commonUtilsMock,
  fsMock,
} = await import("../setup/helpers/shared-mocks.js");

/** @type {() => Promise<Main>} */
const getFreshMain = async () => import("../../src/main.js");

// Mock compression so its filter callback can be exercised in tests
jest.unstable_mockModule("compression", () => {
  /** @type {jest.Mock<(opts: CompressionOptions) => RequestHandler>} */
  const mockCompression = jest.fn(
    /**
     * @param {CompressionOptions} opts
     * @returns {RequestHandler}
     */
    (opts) => {
      /**
       * @param {Request} _req
       * @param {Response} _res
       * @param {NextFunction} next
       */
      const mw = (_req, _res, next) => next();
      mw.options = opts;
      return mw;
    },
  );
  // augment mock with static filter property (which is not in the type definition)
  Object.defineProperty(mockCompression, "filter", {
    value: jest.fn(() => true),
    writable: true,
    configurable: true,
  });

  return { default: mockCompression };
});

const {
  APP_CONSTS,
  SHUTDOWN_SIGNALS,
  LOG_MESSAGES,
  EXIT_CODES,
  ENV_VARS,
  ENV_VALUES,
  EXPRESS_SETTINGS,
  HTTP_STATUS,
  SIGNATURE_PROVIDERS,
} = constsMock;

// IS_TEST=true suppresses the top-level initialize() call inside main.js
const mainModule = await import("../../src/main.js");

describe("Main Entry Point", () => {
  useMockCleanup(() => {
    syncServiceMock.stop.mockResolvedValue(assertType(undefined));
    mainModule.resetShutdownForTest();
    jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
    jest.mocked(routesMock.preloadTemplate).mockResolvedValue("<html></html>");
  });
  useFakeTimers();

  // ── Module Bootstrap ───────────────────────────────────────────────────────
  describe("Module Bootstrap", () => {
    it("should use NPM_PACKAGE_VERSION env var when explicitly set", async () => {
      const originalVersion = process.env[ENV_VARS.NPM_PACKAGE_VERSION];
      try {
        const version = "9.9.9-test";
        process.env[ENV_VARS.NPM_PACKAGE_VERSION] = version;
        await jest.isolateModulesAsync(async () => {
          const freshMain = await getFreshMain();
          expect(freshMain.APP_VERSION).toBe(version);
        });
      } finally {
        if (originalVersion !== undefined)
          process.env[ENV_VARS.NPM_PACKAGE_VERSION] = originalVersion;
        else delete process.env[ENV_VARS.NPM_PACKAGE_VERSION];
      }
    });

    it("should fall back to the version field in package.json when NPM_PACKAGE_VERSION is absent", async () => {
      const originalVersion = process.env[ENV_VARS.NPM_PACKAGE_VERSION];
      try {
        delete process.env[ENV_VARS.NPM_PACKAGE_VERSION];
        await jest.isolateModulesAsync(async () => {
          const { setupCommonMocks: setup } =
            await import("../setup/helpers/mock-setup.js");
          await setup({
            fs: true,
            consts: true,
            logger: true,
            system: true,
            apify: true,
          });
          fsMock.readFileSync.mockImplementation(
            assertType(
              /**
               * @param {PathOrFileDescriptor} p
               * @returns {string}
               */
              (p) =>
                String(p).includes("package.json")
                  ? JSON.stringify({ version: "1.2.3-test" })
                  : "",
            ),
          );
          const freshMain = await getFreshMain();
          expect(typeof freshMain.APP_VERSION).toBe("string");
          expect(freshMain.APP_VERSION.length).toBeGreaterThan(0);
        });
      } finally {
        if (originalVersion !== undefined)
          process.env[ENV_VARS.NPM_PACKAGE_VERSION] = originalVersion;
      }
    });

    it("should fall back to APP_CONSTS.UNKNOWN when package.json has no version field", async () => {
      const originalVersion = process.env[ENV_VARS.NPM_PACKAGE_VERSION];
      try {
        delete process.env[ENV_VARS.NPM_PACKAGE_VERSION];
        await jest.isolateModulesAsync(async () => {
          const { setupCommonMocks: setup } =
            await import("../setup/helpers/mock-setup.js");
          await setup({
            fs: true,
            consts: true,
            logger: true,
            system: true,
            apify: true,
          });
          fsMock.readFileSync.mockReset();
          fsMock.readFileSync.mockReturnValue(JSON.stringify({}));
          const freshMain = await getFreshMain();
          expect(freshMain.APP_VERSION).toBe(constsMock.APP_CONSTS.UNKNOWN);
        });
      } finally {
        if (originalVersion !== undefined)
          process.env[ENV_VARS.NPM_PACKAGE_VERSION] = originalVersion;
      }
    });

    it("should not crash module load when package.json is missing, falling back to UNKNOWN", async () => {
      const originalVersion = process.env[ENV_VARS.NPM_PACKAGE_VERSION];
      try {
        delete process.env[ENV_VARS.NPM_PACKAGE_VERSION];
        await jest.isolateModulesAsync(async () => {
          const { setupCommonMocks: setup } =
            await import("../setup/helpers/mock-setup.js");
          await setup({
            fs: true,
            consts: true,
            logger: true,
            system: true,
            apify: true,
          });
          fsMock.readFileSync.mockReset();
          fsMock.readFileSync.mockImplementation(() => {
            throw Object.assign(new Error(constsMock.NODE_ERROR_CODES.ENOENT), {
              code: constsMock.NODE_ERROR_CODES.ENOENT,
            });
          });
          const freshMain = await getFreshMain();
          expect(freshMain.APP_VERSION).toBe(constsMock.APP_CONSTS.UNKNOWN);
        });
      } finally {
        if (originalVersion !== undefined)
          process.env[ENV_VARS.NPM_PACKAGE_VERSION] = originalVersion;
      }
    });

    it("should exit the process when the top-level initialize() rejects in production", async () => {
      const origEnv = process.env[ENV_VARS.NODE_ENV];
      try {
        process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
        const { systemMock: sm, apifyMock: am } =
          await import("../setup/helpers/shared-mocks.js");
        sm.exit.mockClear();
        am.init.mockRejectedValueOnce(new Error("Init Failure"));
        await jest.isolateModulesAsync(async () => {
          await getFreshMain();
          await flushPromises();
          expect(sm.exit).toHaveBeenCalledWith(constsMock.EXIT_CODES.FAILURE);
        });
      } finally {
        if (origEnv !== undefined) process.env[ENV_VARS.NODE_ENV] = origEnv;
        else delete process.env[ENV_VARS.NODE_ENV];
      }
    });
  });

  // ── initialize() ──────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should orchestrate full system initialization in the correct dependency order", async () => {
      const app = await mainModule.initialize();

      expect(app).toBe(expressAppMock);
      expect(apifyMock.init).toHaveBeenCalled();
      expect(bootstrapMock.ensureLocalInputExists).toHaveBeenCalled();
      expect(webhookManagerMock.init).toHaveBeenCalled();
      expect(duckDbMock.getDbInstance).toHaveBeenCalled();
      expect(syncServiceMock.start).toHaveBeenCalled();
      expect(webhookManagerMock.generateWebhooks).toHaveBeenCalled();
      expect(hotReloadMock.init).toHaveBeenCalled();
      expect(hotReloadMock.start).toHaveBeenCalled();
      expect(expressAppMock.use).toHaveBeenCalled();
      expect(expressAppMock.all).toHaveBeenCalled();
    });

    it("should not call Actor.pushData for the startup event in the test environment", async () => {
      await mainModule.initialize();
      expect(apifyMock.pushData).not.toHaveBeenCalled();
    });

    it("should run ensureLocalInputExists when not running on the Apify platform", async () => {
      apifyMock.isAtHome.mockReturnValue(false);
      await mainModule.initialize();
      expect(bootstrapMock.ensureLocalInputExists).toHaveBeenCalled();
    });

    it("should skip ensureLocalInputExists when running on the Apify platform", async () => {
      apifyMock.isAtHome.mockReturnValue(true);
      await mainModule.initialize();
      expect(bootstrapMock.ensureLocalInputExists).not.toHaveBeenCalled();
    });

    it("should set trust proxy to true on the Apify platform", async () => {
      apifyMock.isAtHome.mockReturnValue(true);
      await mainModule.initialize();
      expect(expressAppMock.set).toHaveBeenCalledWith(
        EXPRESS_SETTINGS.TRUST_PROXY,
        true,
      );
    });

    it("should set trust proxy to 1 when self-hosted to prevent X-Forwarded-For spoofing", async () => {
      apifyMock.isAtHome.mockReturnValue(false);
      await mainModule.initialize();
      expect(expressAppMock.set).toHaveBeenCalledWith(
        EXPRESS_SETTINGS.TRUST_PROXY,
        1,
      );
    });

    it("should proceed with degraded read model and continue when DB initialization fails", async () => {
      duckDbMock.getDbInstance.mockRejectedValueOnce(new Error("DB locked"));
      const app = await mainModule.initialize();
      expect(app).toBe(expressAppMock);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.INIT_DB_SYNC_FAILED,
      );
      expect(webhookManagerMock.init).toHaveBeenCalled();
    });

    it("should proceed with degraded read model when syncService.start() fails", async () => {
      syncServiceMock.start.mockRejectedValueOnce(
        new Error("Sync start failed"),
      );
      const app = await mainModule.initialize();
      expect(app).toBe(expressAppMock);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.INIT_DB_SYNC_FAILED,
      );
    });

    it("should propagate the error when webhookManager.init() throws", async () => {
      const errorMsg = "WebhookManager init failed";
      jest
        .mocked(webhookManagerMock.init)
        .mockRejectedValueOnce(new Error(errorMsg));
      await expect(mainModule.initialize()).rejects.toThrow(errorMsg);
    });

    it("should generate all webhooks from scratch when none exist", async () => {
      const urlCount = 3;
      jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
      await mainModule.initialize({ urlCount });
      expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(
        urlCount,
        expect.any(Number),
      );
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: urlCount }),
        LOG_MESSAGES.SCALING_INITIALIZING,
      );
    });

    it("should generate only the missing webhooks needed to reach urlCount", async () => {
      const urlCount = 5;
      /** @type {WebhookData[]} */
      const existingWebhooks = [
        assertType({ id: "wh_1", expiresAt: "2026-01-01T00:00:00Z" }),
        assertType({ id: "wh_2", expiresAt: "2026-01-01T00:00:00Z" }),
      ];
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue(existingWebhooks);

      await mainModule.initialize({ urlCount });

      expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(
        urlCount - existingWebhooks.length, // 5 - 2 = 3
        expect.any(Number),
      );
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: urlCount - existingWebhooks.length }),
        LOG_MESSAGES.SCALING_UP,
      );
    });

    it("should log SCALING_LIMIT_REACHED and not remove webhooks when active count exceeds urlCount", async () => {
      /** @type {WebhookData[]} */
      const activeWebhooks = assertType([
        { id: "wh_1" },
        { id: "wh_2" },
        { id: "wh_3" },
      ]);
      const urlCount = 2;
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue(activeWebhooks);
      await mainModule.initialize({ urlCount });
      expect(webhookManagerMock.generateWebhooks).not.toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          active: activeWebhooks.length,
          requested: urlCount,
        }),
        LOG_MESSAGES.SCALING_LIMIT_REACHED,
      );
    });

    it("should log SCALING_RESUMING when active webhook count exactly matches urlCount", async () => {
      /** @type {WebhookData[]} */
      const activeWebhooks = assertType([
        { id: "wh_1" },
        { id: "wh_2" },
        { id: "wh_3" },
      ]);
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue(activeWebhooks);

      await mainModule.initialize({ urlCount: activeWebhooks.length });

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: activeWebhooks.length }),
        LOG_MESSAGES.SCALING_RESUMING,
      );
    });

    it("should call updateRetention with the configured retentionHours when active webhooks exist", async () => {
      const retentionHours = 72;
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValue([assertType({ id: "wh_1" })]);
      await mainModule.initialize({ retentionHours });
      expect(webhookManagerMock.updateRetention).toHaveBeenCalledWith(
        retentionHours,
      );
    });

    it("should not call updateRetention on a cold start with no existing webhooks", async () => {
      jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
      await mainModule.initialize({ urlCount: 3 });
      expect(webhookManagerMock.updateRetention).not.toHaveBeenCalled();
    });

    it("should pass the configured retentionHours to generateWebhooks on a cold start", async () => {
      const retentionHours = 48;
      const urlCount = 2;
      jest.mocked(webhookManagerMock.getAllActive).mockReturnValue([]);
      await mainModule.initialize({ urlCount, retentionHours });
      expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(
        urlCount,
        retentionHours,
      );
    });

    it("should override input from process.env.INPUT when running locally with a valid JSON object", async () => {
      apifyMock.isAtHome.mockReturnValue(false);
      try {
        const urlCount = 5;
        process.env[ENV_VARS.INPUT] = JSON.stringify({ urlCount });
        await mainModule.initialize();
        expect(loggerMock.info).toHaveBeenCalledWith(
          LOG_MESSAGES.INPUT_ENV_VAR_PARSED,
        );
        expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(
          urlCount,
          expect.any(Number),
        );
      } finally {
        delete process.env[ENV_VARS.INPUT];
      }
    });

    it("should ignore process.env.INPUT and not log INPUT_ENV_VAR_PARSED when running on the Apify platform", async () => {
      apifyMock.isAtHome.mockReturnValue(true);
      try {
        process.env[ENV_VARS.INPUT] = '{"urlCount": 5}';
        await mainModule.initialize();
        expect(loggerMock.info).not.toHaveBeenCalledWith(
          LOG_MESSAGES.INPUT_ENV_VAR_PARSED,
        );
      } finally {
        delete process.env[ENV_VARS.INPUT];
      }
    });

    it("should warn and fall back when process.env.INPUT contains invalid JSON", async () => {
      apifyMock.isAtHome.mockReturnValue(false);
      try {
        process.env[ENV_VARS.INPUT] = "not-json{{";
        await mainModule.initialize();
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Object) }),
          LOG_MESSAGES.INPUT_ENV_VAR_PARSE_FAILED,
        );
      } finally {
        delete process.env[ENV_VARS.INPUT];
      }
    });

    it("should warn and fall back when process.env.INPUT parses to an array", async () => {
      apifyMock.isAtHome.mockReturnValue(false);
      try {
        process.env[ENV_VARS.INPUT] = "[]";
        await mainModule.initialize();
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Object) }),
          LOG_MESSAGES.INPUT_ENV_VAR_PARSE_FAILED,
        );
      } finally {
        delete process.env[ENV_VARS.INPUT];
      }
    });

    it.each(["null", "42", "true", '"a string"'])(
      "should warn and fall back when process.env.INPUT parses to the primitive %s",
      async (val) => {
        apifyMock.isAtHome.mockReturnValue(false);
        try {
          process.env[ENV_VARS.INPUT] = val;
          await mainModule.initialize();
          expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Object) }),
            LOG_MESSAGES.INPUT_ENV_VAR_PARSE_FAILED,
          );
        } finally {
          delete process.env[ENV_VARS.INPUT];
        }
      },
    );

    it("should not register the JSON parser middleware when enableJSONParsing is false", async () => {
      await mainModule.initialize({ enableJSONParsing: false });
      expect(
        jest.mocked(middlewareMock.createJsonParserMiddleware).mock.calls
          .length,
      ).toBe(0);
    });

    it("should register the JSON parser middleware when enableJSONParsing is true", async () => {
      await mainModule.initialize({ enableJSONParsing: true });
      expect(middlewareMock.createJsonParserMiddleware).toHaveBeenCalled();
    });

    it("should warn and still complete when initialize() is called a second time without shutdown", async () => {
      await mainModule.initialize();
      jest.clearAllMocks();
      const app = await mainModule.initialize();
      expect(app).toBe(expressAppMock);
      expect(loggerMock.warn).toHaveBeenCalled();
    });

    it("should stop previous hotReloadManager when initialize() is called again without shutdown", async () => {
      await mainModule.initialize();
      hotReloadMock.stop.mockClear();
      await mainModule.initialize();
      expect(hotReloadMock.stop).toHaveBeenCalled();
    });

    it("should handle concurrent initialize calls correctly and cover falsy interval branches", async () => {
      mainModule.resetShutdownForTest();
      // Start two concurrent calls. The first will set isInitialized = true,
      // the second will hit the re-entrancy block before intervals are set.
      const p1 = mainModule.initialize();
      const p2 = mainModule.initialize();
      await Promise.all([p1, p2]);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        LOG_MESSAGES.ALREADY_INITIALIZED,
      );
    });

    it("should not crash or attempt to clear intervals if they are falsy during re-entrancy", async () => {
      const origSetInterval = global.setInterval;
      try {
        global.setInterval = () => assertType(null); // Falsy handle
        await mainModule.initialize();
        loggerMock.warn.mockClear();
        await mainModule.initialize();
        expect(loggerMock.warn).toHaveBeenCalledWith(
          LOG_MESSAGES.ALREADY_INITIALIZED,
        );
        expect(hotReloadMock.stop).toHaveBeenCalled();
      } finally {
        global.setInterval = origSetInterval;
      }
    });

    it("should warn if hotReloadManager fails to stop during re-entrancy", async () => {
      await mainModule.initialize();
      hotReloadMock.stop.mockRejectedValueOnce(new Error("Stop Error"));
      loggerMock.warn.mockClear();
      await mainModule.initialize();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.HOT_RELOAD_STOP_FAILED,
      );
    });

    it("should clear sseHeartbeat and cleanupInterval during re-entrancy if set", async () => {
      const origEnv = process.env[ENV_VARS.NODE_ENV];
      try {
        process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
        await jest.isolateModulesAsync(async () => {
          const freshMain = await getFreshMain();
          freshMain.resetShutdownForTest();

          expressAppMock.listen.mockImplementationOnce(
            assertType(
              /**
               * @param {number} _port
               * @param {(error?: Error) => void} cb
               * @returns {Server}
               */
              (_port, cb) => {
                if (typeof cb === "function") cb();
                return assertType({ close: jest.fn() });
              },
            ),
          );

          await freshMain.initialize();
          // Both intervals are now truthy.

          const clearIntervalSpy = jest.spyOn(global, "clearInterval");
          const expectedIntervals = 2;
          await freshMain.initialize();
          expect(clearIntervalSpy).toHaveBeenCalledTimes(expectedIntervals);
          expect(loggerMock.warn).toHaveBeenCalledWith(
            LOG_MESSAGES.ALREADY_INITIALIZED,
          );
        });
      } finally {
        process.env[ENV_VARS.NODE_ENV] = origEnv;
      }
    });

    it("should schedule testAndExit shutdown after STARTUP_TEST_EXIT_DELAY_MS when flag is set", async () => {
      // Verifies: testAndExit is now reachable from the test environment
      syncServiceMock.stop.mockResolvedValue(assertType(undefined));
      await mainModule.initialize({ testAndExit: true });

      jest.advanceTimersByTime(APP_CONSTS.STARTUP_TEST_EXIT_DELAY_MS);
      const TICKS = 10;
      await flushPromises(TICKS);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ signal: SHUTDOWN_SIGNALS.TESTANDEXIT }),
        LOG_MESSAGES.SHUTDOWN_START,
      );
      expect(hotReloadMock.stop).toHaveBeenCalled();
      expect(syncServiceMock.stop).toHaveBeenCalled();
    });

    it("should propagate the error when preloadTemplate() fails during initialization", async () => {
      // preloadTemplate is awaited with no surrounding try/catch — a rejection
      // propagates directly out of initialize() as an unhandled init failure.
      const errorMsg = "Failed to read index.html";
      routesMock.preloadTemplate.mockRejectedValueOnce(new Error(errorMsg));
      await expect(mainModule.initialize()).rejects.toThrow(errorMsg);
    });

    it("should handle a null Actor.getInput() response without throwing", async () => {
      apifyMock.getInput.mockResolvedValueOnce(null);
      const app = await mainModule.initialize();
      expect(app).toBe(expressAppMock);
    });
  });

  // ── shutdown() ────────────────────────────────────────────────────────────
  describe("shutdown()", () => {
    it("should stop hot-reload, sync service, and persist state in order", async () => {
      await mainModule.initialize();
      jest.clearAllMocks();
      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      expect(hotReloadMock.stop).toHaveBeenCalled();
      expect(syncServiceMock.stop).toHaveBeenCalled();
      expect(webhookManagerMock.persist).toHaveBeenCalled();
    });

    it("should force-exit via systemExit after SHUTDOWN_TIMEOUT_MS elapses", async () => {
      syncServiceMock.stop.mockReturnValue(assertType(new Promise(() => {})));
      mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      jest.advanceTimersByTime(APP_CONSTS.SHUTDOWN_TIMEOUT_MS + 1);
      expect(loggerMock.error).toHaveBeenCalledWith(
        LOG_MESSAGES.FORCE_SHUTDOWN,
      );
      expect(systemMock.exit).toHaveBeenCalledWith(EXIT_CODES.FAILURE);
    });

    it("should return early without finalCleanup when signal is not TEST_COMPLETE in the test environment", async () => {
      await mainModule.shutdown(SHUTDOWN_SIGNALS.SIGINT);
      expect(syncServiceMock.stop).toHaveBeenCalled();
      expect(webhookManagerMock.persist).not.toHaveBeenCalled();
    });

    it("should not throw when shutdown() is called before initialize() has run", async () => {
      mainModule.resetShutdownForTest();
      await expect(
        mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE),
      ).resolves.not.toThrow();
      expect(syncServiceMock.stop).toHaveBeenCalled();
    });

    it("should call end() on all open SSE clients during shutdown to avoid hanging connections", async () => {
      await mainModule.initialize();
      /** @type {Set<ServerResponse>} */
      const clientsSet = assertType(
        jest.mocked(routesMock.createLogStreamHandler).mock.calls[0]?.[0],
      );
      /** @type {ServerResponse} */
      const client1 = assertType({ write: jest.fn(), end: jest.fn() });
      /** @type {ServerResponse} */
      const client2 = assertType({ write: jest.fn(), end: jest.fn() });
      clientsSet.add(client1);
      clientsSet.add(client2);

      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);

      expect(client1.end).toHaveBeenCalled();
      expect(client2.end).toHaveBeenCalled();
      expect(clientsSet.size).toBe(0);
    });

    it("should stop the sseHeartbeat interval so no writes occur after shutdown", async () => {
      await mainModule.initialize();
      /** @type {Set<ServerResponse>} */
      const clientsSet = assertType(
        jest.mocked(routesMock.createLogStreamHandler).mock.calls[0]?.[0],
      );
      /** @type {ServerResponse} */
      const mockClient = assertType({ write: jest.fn(), end: jest.fn() });
      clientsSet.add(mockClient);

      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      jest.mocked(mockClient.write).mockClear();

      const timeOffsetMultiplier = 5;
      const timeOffset =
        APP_CONSTS.SSE_HEARTBEAT_INTERVAL_MS * timeOffsetMultiplier;
      jest.advanceTimersByTime(timeOffset);
      expect(mockClient.write).not.toHaveBeenCalled();
    });
  });

  // ── Shutdown Resilience ───────────────────────────────────────────────────
  describe("Shutdown Resilience", () => {
    it("should continue through cleanup when hotReloadManager.stop() throws", async () => {
      await mainModule.initialize();
      hotReloadMock.stop.mockRejectedValueOnce(
        assertType(new Error("Hot reload stop failed")),
      );
      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.SHUTDOWN_HOT_RELOAD_FAILED,
      );
      expect(syncServiceMock.stop).toHaveBeenCalled();
      expect(webhookManagerMock.persist).toHaveBeenCalled();
    });

    it("should continue through cleanup when appState.destroy() throws", async () => {
      await mainModule.initialize();
      const { appStateMock } = await import("../setup/helpers/shared-mocks.js");
      appStateMock.destroy.mockImplementationOnce(() => {
        throw new Error("AppState destroy failed");
      });
      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.SHUTDOWN_APP_STATE_FAILED,
      );
      expect(syncServiceMock.stop).toHaveBeenCalled();
      expect(webhookManagerMock.persist).toHaveBeenCalled();
    });

    it("should log a warning and not propagate when webhookManager.persist() throws in finalCleanup", async () => {
      jest
        .mocked(webhookManagerMock.persist)
        .mockRejectedValueOnce(assertType(new Error("Persist failed")));
      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.SHUTDOWN_FINAL_CLEANUP_FAILED,
      );
      expect(syncServiceMock.stop).toHaveBeenCalled();
    });

    it("should handle partial initialization state where hotReloadManager is created but appState is not", async () => {
      const errorMsg = "Partial init error";
      apifyMock.init.mockRejectedValueOnce(new Error(errorMsg));
      await expect(mainModule.initialize()).rejects.toThrow(errorMsg);

      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);

      expect(hotReloadMock.stop).not.toHaveBeenCalled();
      expect(loggerMock.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        LOG_MESSAGES.SHUTDOWN_APP_STATE_FAILED,
      );
    });

    it("should handle partial initialization shutdown (appState truthy, hotReloadManager falsy)", async () => {
      const errorMsg = "Fail before hotReloadManager";
      // createRequestIdMiddleware is before hotReloadManager init
      middlewareMock.createRequestIdMiddleware.mockImplementationOnce(() => {
        throw new Error(errorMsg);
      });
      await expect(mainModule.initialize()).rejects.toThrow(errorMsg);

      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      expect(appStateMock.destroy).toHaveBeenCalled();
      expect(hotReloadMock.stop).not.toHaveBeenCalled();
      expect(syncServiceMock.stop).toHaveBeenCalled();
    });

    it("should not crash if forceExitTimer is falsy during shutdown (normal path)", async () => {
      const origSetTimeout = global.setTimeout;
      try {
        global.setTimeout = assertType(() => null); // Falsy timer handle
        await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
        expect(syncServiceMock.stop).toHaveBeenCalled();
        expect(webhookManagerMock.persist).toHaveBeenCalled();
      } finally {
        global.setTimeout = origSetTimeout;
      }
    });

    it("should handle falsy forceExitTimer when signal is not TEST_COMPLETE", async () => {
      const origSetTimeout = global.setTimeout;
      try {
        global.setTimeout = assertType(() => null);
        await mainModule.shutdown(SHUTDOWN_SIGNALS.SIGTERM);
        expect(syncServiceMock.stop).toHaveBeenCalled();
        expect(webhookManagerMock.persist).not.toHaveBeenCalled();
      } finally {
        global.setTimeout = origSetTimeout;
      }
    });

    it("should log a warning and not propagate when Actor.exit() throws in production finalCleanup", async () => {
      const origEnv = process.env[ENV_VARS.NODE_ENV];
      try {
        process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
        apifyMock.exit.mockRejectedValueOnce(new Error("Actor exit failed"));
        await jest.isolateModulesAsync(async () => {
          const freshMain = await getFreshMain();
          freshMain.resetShutdownForTest();
          await freshMain.initialize();
          await freshMain.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
          expect(webhookManagerMock.persist).toHaveBeenCalled();
          expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Object) }),
            LOG_MESSAGES.SHUTDOWN_FINAL_CLEANUP_FAILED,
          );
          expect(systemMock.exit).toHaveBeenCalledWith(EXIT_CODES.SUCCESS);
        });
      } finally {
        if (origEnv !== undefined) process.env[ENV_VARS.NODE_ENV] = origEnv;
        else delete process.env[ENV_VARS.NODE_ENV];
      }
    });

    it("should still clear clients and complete shutdown when a client's end() throws", async () => {
      await mainModule.initialize();
      /** @type {Set<ServerResponse>} */
      const clientsSet = assertType(
        jest.mocked(routesMock.createLogStreamHandler).mock.calls[0]?.[0],
      );
      /** @type {ServerResponse} */
      const throwingClient = assertType({
        write: jest.fn(),
        end: jest.fn(() => {
          throw new Error("ERR_HTTP2_INVALID_STREAM");
        }),
      });
      clientsSet.add(throwingClient);
      await expect(
        mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE),
      ).resolves.not.toThrow();
      expect(clientsSet.size).toBe(0);
    });
  });

  // ── Global Event Handlers ─────────────────────────────────────────────────
  describe("Global Event Handlers", () => {
    it("should register exactly one handler each for SIGTERM and SIGINT", () => {
      mainModule.resetShutdownForTest();
      systemMock.on.mockClear();
      mainModule.setupGracefulShutdown();
      mainModule.setupGracefulShutdown(); // second call must be a no-op

      const sigtermCount = systemMock.on.mock.calls.filter(
        (c) => c[0] === SHUTDOWN_SIGNALS.SIGTERM,
      ).length;
      const sigintCount = systemMock.on.mock.calls.filter(
        (c) => c[0] === SHUTDOWN_SIGNALS.SIGINT,
      ).length;
      expect(sigtermCount).toBe(1);
      expect(sigintCount).toBe(1);
    });

    it("should register handlers for Apify migrating and aborting platform events", () => {
      mainModule.resetShutdownForTest();
      apifyMock.on.mockClear();
      mainModule.setupGracefulShutdown();
      const registeredEvents = apifyMock.on.mock.calls.map((c) => c[0]);
      expect(registeredEvents).toContain("migrating");
      expect(registeredEvents).toContain("aborting");
    });

    it("should retry shutdown on a transient failure and succeed on the second attempt", async () => {
      mainModule.resetShutdownForTest();
      systemMock.on.mockClear();
      mainModule.setupGracefulShutdown();

      /** @type {function(string): void} */
      const sigtermHandler = assertType(
        systemMock.on.mock.calls.find(
          (c) => c[0] === SHUTDOWN_SIGNALS.SIGTERM,
        )?.[1],
      );
      expect(sigtermHandler).toBeDefined();

      syncServiceMock.stop.mockRejectedValueOnce(
        assertType(new Error("Transient stop failure")),
      );
      sigtermHandler(SHUTDOWN_SIGNALS.SIGTERM);
      await flushPromises();
      jest.advanceTimersByTime(APP_CONSTS.SHUTDOWN_RETRY_DELAY_MS);
      await flushPromises();

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: SHUTDOWN_SIGNALS.SIGTERM,
          attempts: 0,
        }),
        LOG_MESSAGES.SHUTDOWN_RETRY,
      );

      const shutdownAttempts = 2;
      expect(syncServiceMock.stop).toHaveBeenCalledTimes(shutdownAttempts);
    });

    it("should force-exit via systemExit after all retry attempts are exhausted", async () => {
      mainModule.resetShutdownForTest();
      systemMock.on.mockClear();
      const originalTimeout = constsMock.APP_CONSTS.SHUTDOWN_TIMEOUT_MS;

      try {
        constsMock.APP_CONSTS.SHUTDOWN_TIMEOUT_MS = 99_999_999;

        syncServiceMock.stop.mockRejectedValue(
          assertType(new Error("Persistent failure")),
        );
        mainModule.setupGracefulShutdown();
        systemMock.on.mock.calls.find(
          (c) => c[0] === SHUTDOWN_SIGNALS.SIGINT,
        )?.[1]();

        await flushPromises();

        for (
          let j = 0;
          j < constsMock.APP_CONSTS.SHUTDOWN_RETRY_MAX_ATTEMPTS;
          j++
        ) {
          jest.advanceTimersByTime(
            constsMock.APP_CONSTS.SHUTDOWN_RETRY_DELAY_MS,
          );
          await flushPromises();
        }

        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ signal: SHUTDOWN_SIGNALS.SIGINT }),
          constsMock.LOG_MESSAGES.SHUTDOWN_FAILED_AFTER_RETRIES,
        );
        expect(systemMock.exit).toHaveBeenCalledWith(
          constsMock.EXIT_CODES.FAILURE,
        );
      } finally {
        constsMock.APP_CONSTS.SHUTDOWN_TIMEOUT_MS = originalTimeout;
      }
    });

    it("should ignore subsequent shutdown signals while shutdown is already in progress", async () => {
      mainModule.resetShutdownForTest();
      systemMock.on.mockClear();
      mainModule.setupGracefulShutdown();

      /** @type {function(string): void} */
      const sigtermHandler = assertType(
        systemMock.on.mock.calls.find(
          (c) => c[0] === SHUTDOWN_SIGNALS.SIGTERM,
        )?.[1],
      );
      expect(sigtermHandler).toBeDefined();

      syncServiceMock.stop.mockClear();
      sigtermHandler(SHUTDOWN_SIGNALS.SIGTERM);
      sigtermHandler(SHUTDOWN_SIGNALS.SIGTERM);

      await flushPromises();
      expect(syncServiceMock.stop).toHaveBeenCalledTimes(1);
    });

    it("should trigger graceful shutdown when the Apify migrating event fires", async () => {
      mainModule.resetShutdownForTest();
      apifyMock.on.mockClear();
      syncServiceMock.stop.mockClear();
      mainModule.setupGracefulShutdown();

      /** @type {function(): void} */
      const migratingHandler = assertType(
        apifyMock.on.mock.calls.find((c) => c[0] === "migrating")?.[1],
      );
      expect(migratingHandler).toBeDefined();

      await migratingHandler();
      await flushPromises();
      expect(syncServiceMock.stop).toHaveBeenCalled();
    });

    it("should ignore the aborting event when shutdown is already in progress from migrating", async () => {
      mainModule.resetShutdownForTest();
      apifyMock.on.mockClear();
      mainModule.setupGracefulShutdown();

      /** @type {function(): void} */
      const migratingHandler = assertType(
        apifyMock.on.mock.calls.find((c) => c[0] === "migrating")?.[1],
      );
      /** @type {function(): void} */
      const abortingHandler = assertType(
        apifyMock.on.mock.calls.find((c) => c[0] === "aborting")?.[1],
      );

      await migratingHandler();
      expect(syncServiceMock.stop).toHaveBeenCalled();
      syncServiceMock.stop.mockClear();
      await abortingHandler();
      expect(syncServiceMock.stop).not.toHaveBeenCalled();
    });
  });

  // ── SSE Heartbeat ─────────────────────────────────────────────────────────
  describe("SSE Heartbeat", () => {
    it("should write heartbeat messages to all connected clients at the configured interval", async () => {
      await mainModule.initialize();
      /** @type {Set<ServerResponse>} */
      const clientsSet = assertType(
        jest.mocked(routesMock.createLogStreamHandler).mock.calls[0]?.[0],
      );
      /** @type {ServerResponse} */
      const mockClient = assertType({ write: jest.fn(), end: jest.fn() });
      clientsSet.add(mockClient);

      jest.advanceTimersByTime(APP_CONSTS.SSE_HEARTBEAT_INTERVAL_MS);

      expect(mockClient.write).toHaveBeenCalledWith(
        constsMock.SSE_CONSTS.HEARTBEAT_MESSAGE,
      );
      clientsSet.delete(mockClient);
    });

    it("should remove a disconnected client from the set when writing a heartbeat throws", async () => {
      await mainModule.initialize();
      /** @type {Set<ServerResponse>} */
      const clientsSet = assertType(
        jest.mocked(routesMock.createLogStreamHandler).mock.calls[0]?.[0],
      );
      /** @type {ServerResponse} */
      const failingClient = assertType({
        write: jest.fn(() => {
          throw new Error("EPIPE");
        }),
        end: jest.fn(),
      });
      clientsSet.add(failingClient);

      jest.advanceTimersByTime(APP_CONSTS.SSE_HEARTBEAT_INTERVAL_MS);
      expect(clientsSet.has(failingClient)).toBe(false);
    });

    it("should not crash when the sseHeartbeat setInterval handle has no unref method", async () => {
      const origSetInterval = global.setInterval;
      try {
        global.setInterval = assertType(
          /**
           * @param {(...args: any[]) => void} cb
           * @param {number} ms
           * @param {...any[]} args
           */
          (cb, ms, ...args) => {
            const id = origSetInterval(cb, ms, ...args);
            id.unref = assertType(undefined);
            return id;
          },
        );
        await jest.isolateModulesAsync(async () => {
          const { setupCommonMocks: setup } =
            await import("../setup/helpers/mock-setup.js");
          await setup({
            system: true,
            apify: true,
            consts: true,
            logger: true,
            express: true,
            sync: true,
          });
          const freshMain = await getFreshMain();
          await freshMain.initialize();
          expect(freshMain.sseHeartbeat).toBeDefined();
          await freshMain.shutdown(constsMock.SHUTDOWN_SIGNALS.TEST_COMPLETE);
          expect(freshMain.sseHeartbeat).toBeUndefined();
          expect(syncServiceMock.stop).toHaveBeenCalled();
        });
      } finally {
        global.setInterval = origSetInterval;
      }
    });

    it("should stop writing heartbeats after shutdown clears the interval", async () => {
      await mainModule.initialize();
      /** @type {Set<ServerResponse>} */
      const clientsSet = assertType(
        jest.mocked(routesMock.createLogStreamHandler).mock.calls[0]?.[0],
      );
      /** @type {ServerResponse} */
      const mockClient = assertType({ write: jest.fn(), end: jest.fn() });
      clientsSet.add(mockClient);

      await mainModule.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
      jest.mocked(mockClient.write).mockClear();

      const timeOffsetMultiplier = 5;
      const timeOffset =
        APP_CONSTS.SSE_HEARTBEAT_INTERVAL_MS * timeOffsetMultiplier;
      jest.advanceTimersByTime(timeOffset);
      expect(mockClient.write).not.toHaveBeenCalled();
    });

    it("should continue writing to healthy clients after evicting one broken client", async () => {
      await mainModule.initialize();
      /** @type {Set<ServerResponse>} */
      const clientsSet = assertType(
        jest.mocked(routesMock.createLogStreamHandler).mock.calls[0]?.[0],
      );
      /** @type {ServerResponse} */
      const healthyClient = assertType({ write: jest.fn(), end: jest.fn() });
      /** @type {ServerResponse} */
      const failingClient = assertType({
        write: jest.fn(() => {
          throw new Error("EPIPE");
        }),
        end: jest.fn(),
      });
      clientsSet.add(failingClient);
      clientsSet.add(healthyClient);

      jest.advanceTimersByTime(APP_CONSTS.SSE_HEARTBEAT_INTERVAL_MS);

      expect(clientsSet.has(failingClient)).toBe(false);
      expect(healthyClient.write).toHaveBeenCalledWith(
        constsMock.SSE_CONSTS.HEARTBEAT_MESSAGE,
      );
    });
  });

  // ── Middleware and Route Callbacks ────────────────────────────────────────
  describe("Middleware and Route Callbacks", () => {
    beforeEach(async () => {
      await mainModule.initialize();
    });

    it("should pass a live authKey getter to createAuthMiddleware that reflects appState changes", async () => {
      const { appStateMock } = await import("../setup/helpers/shared-mocks.js");
      /** @type {function(): string} */
      const authCallback = assertType(
        jest.mocked(middlewareMock.createAuthMiddleware).mock.calls[0]?.[0],
      );
      appStateMock.authKey = "key-v1";
      expect(authCallback()).toBe("key-v1");
      appStateMock.authKey = "key-v2";
      expect(authCallback()).toBe("key-v2");
    });

    it("should pass a valid getter to createHealthRoutes", async () => {
      /** @type {function(): number} */
      const getActiveCount = assertType(
        jest.mocked(routesMock.createHealthRoutes).mock.calls[0]?.[0],
      );
      /** @type {WebhookData[]} */
      const activeWebhooks = assertType([{}, {}]);
      jest
        .mocked(webhookManagerMock.getAllActive)
        .mockReturnValueOnce(activeWebhooks);
      expect(typeof getActiveCount).toBe("function");
      expect(getActiveCount()).toBe(activeWebhooks.length);
      expect(webhookManagerMock.getAllActive).toHaveBeenCalled();
    });

    it("should return empty string from the authKey getter when appState has no authKey", async () => {
      const { appStateMock } = await import("../setup/helpers/shared-mocks.js");
      /** @type {function(): string} */
      const authCallback = assertType(
        jest.mocked(middlewareMock.createAuthMiddleware).mock.calls[0]?.[0],
      );
      appStateMock.authKey = assertType(undefined);
      expect(authCallback()).toBe("");
    });

    it("should set forcedStatus on the request when ?status holds a valid HTTP status code", async () => {
      const webhookCalls = expressAppMock.all.mock.calls.filter(
        (c) => c[0] === constsMock.APP_ROUTES.WEBHOOK,
      );
      const statusMiddleware = webhookCalls[1]?.[1];
      expect(statusMiddleware).toBeDefined();

      const req = createMockRequest({
        query: {
          [constsMock.QUERY_PARAMS.STATUS]: HTTP_STATUS.NOT_FOUND.toString(),
        },
      });
      const next = createMockNextFunction();
      commonUtilsMock.validateStatusCode.mockReturnValueOnce(true);
      statusMiddleware(req, createMockResponse(), next);

      expect(assertType(req).forcedStatus).toBe(HTTP_STATUS.NOT_FOUND);
      expect(next).toHaveBeenCalled();
    });

    it("should call next() without setting forcedStatus when the ?status query param is invalid", async () => {
      const webhookCalls = expressAppMock.all.mock.calls.filter(
        (c) => c[0] === constsMock.APP_ROUTES.WEBHOOK,
      );
      const statusMiddleware = webhookCalls[1]?.[1];
      const req = createMockRequest();
      const next = createMockNextFunction();
      commonUtilsMock.validateStatusCode.mockReturnValueOnce(false);
      statusMiddleware(req, createMockResponse(), next);

      expect(assertType(req).forcedStatus).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it("should call next() without setting forcedStatus when the ?status query param is absent", async () => {
      const webhookCalls = expressAppMock.all.mock.calls.filter(
        (c) => c[0] === constsMock.APP_ROUTES.WEBHOOK,
      );
      const statusMiddleware = webhookCalls[1]?.[1];
      const req = createMockRequest({ query: {} }); // no `status` key
      const next = createMockNextFunction();
      statusMiddleware(req, createMockResponse(), next);
      expect(assertType(req).forcedStatus).toBeUndefined();
      expect(next).toHaveBeenCalled();
      expect(commonUtilsMock.validateStatusCode).not.toHaveBeenCalled();
    });

    it("should return null from getSignatureStatus when no signature provider is configured", () => {
      /** @type {DashboardDependencies} */
      const dashOpts = assertType(
        jest.mocked(routesMock.createDashboardHandler).mock.calls[0]?.[0],
      );
      expect(dashOpts.getSignatureStatus()).toBeNull();
    });

    it("should return the uppercase provider name from getSignatureStatus when signature is configured", async () => {
      const { loggerMiddlewareMock } =
        await import("../setup/helpers/shared-mocks.js");
      Object.defineProperty(loggerMiddlewareMock, "options", {
        value: {
          signatureVerification: {
            provider: SIGNATURE_PROVIDERS.STRIPE,
            secret: "abc",
          },
        },
        configurable: true,
      });
      /** @type {DashboardDependencies} */
      const dashOpts = assertType(
        jest.mocked(routesMock.createDashboardHandler).mock.calls[0]?.[0],
      );
      expect(dashOpts.getSignatureStatus()).toBe(
        SIGNATURE_PROVIDERS.STRIPE.toUpperCase(),
      );
    });

    it("should return null from getSignatureStatus when provider is configured without a secret", async () => {
      const { loggerMiddlewareMock } =
        await import("../setup/helpers/shared-mocks.js");
      Object.defineProperty(loggerMiddlewareMock, "options", {
        value: {
          signatureVerification: { provider: SIGNATURE_PROVIDERS.STRIPE },
        }, // no secret
        configurable: true,
      });
      /** @type {DashboardDependencies} */
      const dashOpts = assertType(
        jest.mocked(routesMock.createDashboardHandler).mock.calls[0]?.[0],
      );
      expect(dashOpts.getSignatureStatus()).toBeNull();
    });

    it("should return null from getSignatureStatus when a secret is set without a provider", async () => {
      const { loggerMiddlewareMock } =
        await import("../setup/helpers/shared-mocks.js");
      Object.defineProperty(loggerMiddlewareMock, "options", {
        value: { signatureVerification: { secret: "orphaned-secret" } }, // no provider
        configurable: true,
      });
      /** @type {DashboardDependencies} */
      const dashOpts = assertType(
        jest.mocked(routesMock.createDashboardHandler).mock.calls[0]?.[0],
      );
      expect(dashOpts.getSignatureStatus()).toBeNull();
    });

    it("should expose the preloaded template via getTemplate() before any setTemplate call", () => {
      /** @type {DashboardDependencies} */
      const dashOpts = assertType(
        jest.mocked(routesMock.createDashboardHandler).mock.calls[0]?.[0],
      );
      expect(dashOpts.getTemplate()).toBe("<html></html>");
    });

    it("should allow setTemplate to update the template returned by getTemplate", () => {
      /** @type {DashboardDependencies} */
      const dashOpts = assertType(
        jest.mocked(routesMock.createDashboardHandler).mock.calls[0]?.[0],
      );
      dashOpts.setTemplate("new-template");
      expect(dashOpts.getTemplate()).toBe("new-template");
    });

    it("should pass live getters for replayMaxRetries and replayTimeoutMs to createReplayHandler", async () => {
      const { appStateMock } = await import("../setup/helpers/shared-mocks.js");
      /** @type {[function(): number, function(): number]} */
      const replayArgs = assertType(
        jest.mocked(routesMock.createReplayHandler).mock.calls[0],
      );
      const replayMaxRetries = 5;
      const replayTimeoutMs = 2000;
      appStateMock.replayMaxRetries = replayMaxRetries;
      appStateMock.replayTimeoutMs = replayTimeoutMs;
      expect(replayArgs[0]()).toBe(replayMaxRetries);
      expect(replayArgs[1]()).toBe(replayTimeoutMs);
    });

    it("should pass live getters with DEFAULT fallbacks to createInfoHandler", async () => {
      const { appStateMock } = await import("../setup/helpers/shared-mocks.js");
      /** @type {InfoDependencies} */
      const infoOpts = assertType(
        jest.mocked(routesMock.createInfoHandler).mock.calls[0]?.[0],
      );
      appStateMock.retentionHours = assertType(undefined);
      appStateMock.maxPayloadSize = assertType(undefined);
      appStateMock.authKey = assertType(undefined);
      expect(infoOpts.getAuthKey()).toBe("");
      expect(infoOpts.getRetentionHours()).toBe(
        APP_CONSTS.DEFAULT_RETENTION_HOURS,
      );
      expect(infoOpts.getMaxPayloadSize()).toBe(
        APP_CONSTS.DEFAULT_PAYLOAD_LIMIT,
      );

      const authKey = "authKey";
      const retentionHours = 48;
      const maxPayloadSize = 1024;
      appStateMock.authKey = authKey;
      appStateMock.retentionHours = retentionHours;
      appStateMock.maxPayloadSize = maxPayloadSize;
      expect(infoOpts.getAuthKey()).toBe(authKey);
      expect(infoOpts.getRetentionHours()).toBe(retentionHours);
      expect(infoOpts.getMaxPayloadSize()).toBe(maxPayloadSize);
    });

    it("should skip compression for the SSE log stream path", async () => {
      const compressionMod = await import("compression");
      /** @type {CompressionFilter} */
      const filter = assertType(
        jest.mocked(compressionMod.default).mock.calls[0]?.[0]?.filter,
      );
      expect(filter).toBeDefined();
      expect(
        filter(
          assertType({ path: constsMock.APP_ROUTES.LOG_STREAM }),
          assertType({}),
        ),
      ).toBe(false);
    });

    it("should skip compression for requests accepting the event-stream MIME type", async () => {
      const compressionMod = await import("compression");
      /** @type {CompressionFilter} */
      const filter = assertType(
        jest.mocked(compressionMod.default).mock.calls[0]?.[0]?.filter,
      );
      expect(
        filter(
          assertType({
            path: "/other",
            headers: { accept: constsMock.MIME_TYPES.EVENT_STREAM },
          }),
          assertType({}),
        ),
      ).toBe(false);
    });

    it("should delegate to the default compression filter for non-SSE routes", async () => {
      const compressionMod = await import("compression");
      /** @type {CompressionFilter} */
      const filter = assertType(
        jest.mocked(compressionMod.default).mock.calls[0]?.[0]?.filter,
      );
      jest.mocked(compressionMod.default.filter).mockClear();
      filter(assertType({ path: "/api", headers: {} }), assertType({}));
      expect(compressionMod.default.filter).toHaveBeenCalled();
    });

    it("should forward APP_VERSION to createDashboardHandler and createInfoHandler", () => {
      /** @type {DashboardDependencies} */
      const dashOpts = assertType(
        jest.mocked(routesMock.createDashboardHandler).mock.calls[0]?.[0],
      );
      /** @type {InfoDependencies} */
      const infoOpts = assertType(
        jest.mocked(routesMock.createInfoHandler).mock.calls[0]?.[0],
      );
      expect(typeof dashOpts.version).toBe("string");
      expect(dashOpts.version.length).toBeGreaterThan(0);
      expect(infoOpts.version).toBe(dashOpts.version);
    });

    it("should register public CSS assets with cacheable static middleware", () => {
      const indexCssRoute = expressAppMock.get.mock.calls.find(
        (call) => call[0] === "/index.css",
      );
      const unauthorizedCssRoute = expressAppMock.get.mock.calls.find(
        (call) => call[0] === "/unauthorized.css",
      );

      expect(indexCssRoute).toBeDefined();
      expect(unauthorizedCssRoute).toBeDefined();

      const cssStaticCall = expressMock.static.mock.calls.find(
        /** @param {unknown[]} call */
        (call) => call[1] && typeof call[1] === "object",
      );

      expect(cssStaticCall).toBeDefined();
      expect(cssStaticCall?.[0]).toEqual(expect.any(String));
      expect(cssStaticCall?.[1]).toMatchObject({
        cacheControl: true,
        etag: true,
        fallthrough: false,
        lastModified: true,
        maxAge: mainModule.CSS_ASSET_CACHE_MAX_AGE,
      });
    });
  });

  // ── Production Lifecycle ──────────────────────────────────────────────────
  describe("Production Lifecycle", () => {
    /** @type {string | undefined} */
    let origEnv;
    /** @type {number} */
    const INIT_TICKS = 30;
    /** @type {typeof mainModule | undefined} */
    let freshMain;
    /** @returns {Server} */
    const makeListeningServer = () =>
      assertType({
        listening: true,
        close: jest.fn((cb) => typeof cb === "function" && cb()),
        closeAllConnections: jest.fn(),
      });

    /**
     * Stubs `expressAppMock.listen` to invoke its callback synchronously and
     * returns a fresh isolated copy of main.js.
     *
     * The caller is responsible for setting NODE_ENV=production before calling
     * this helper, and for restoring it in a `finally` block.
     *
     * @returns {Promise<typeof mainModule>}
     */
    const setupProductionLifecycle = async () => {
      expressAppMock.listen.mockImplementationOnce(
        assertType(
          /**
           * @param {number} _port
           * @param {(error?: Error) => void} cb
           * @returns {Server}
           */
          (_port, cb) => {
            if (typeof cb === "function") cb();
            return makeListeningServer();
          },
        ),
      );
      // jest.isolateModulesAsync returns Promise<void>, not the module.
      // The module must be captured from inside the callback and hoisted out.
      /** @type {typeof mainModule | undefined} */
      let freshMain;
      await jest.isolateModulesAsync(async () => {
        freshMain = await getFreshMain();
      });
      return assertType(freshMain);
    };

    /**
     * Drains the auto-initialization that occurs when main.js is loaded in
     * production mode. This must be called after setupProductionLifecycle() and
     * before any shutdown-related assertions.
     *
     * @returns {Promise<void>}
     */
    const drainAutoInit = async () => {
      // setupProductionLifecycle loads the module in production mode. The
      // top-level if (!IS_TEST) block fires initialize() immediately as a
      // fire-and-forget call. Do NOT call resetShutdownForTest() + initialize()
      // after this: both calls would race through the isInitialized guard before
      // either sets the flag, producing two concurrent cleanupIntervals and
      // doubling the expected callback count. Drain the single auto-init instead.
      await flushPromises(INIT_TICKS);
    };

    beforeEach(async () => {
      origEnv = process.env[ENV_VARS.NODE_ENV];
      process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
      // Do NOT initialize main here; tests will call setupProductionLifecycle() explicitly
      // to control setup timing.
    });

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env[ENV_VARS.NODE_ENV];
      } else {
        process.env[ENV_VARS.NODE_ENV] = origEnv;
      }
    });

    it("should start listening on the configured port in production mode", async () => {
      await setupProductionLifecycle();
      await drainAutoInit();

      expect(expressAppMock.listen).toHaveBeenCalledWith(
        APP_CONSTS.DEFAULT_PORT,
        expect.any(Function),
      );
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ port: expect.any(Number) }),
        expect.stringContaining(String(APP_CONSTS.DEFAULT_PORT)),
      );
    });

    it("should swallow a pushData error and allow initialization to complete in production", async () => {
      apifyMock.pushData.mockRejectedValueOnce(new Error("pushData error"));
      freshMain = await setupProductionLifecycle();
      await drainAutoInit();

      expect(freshMain?.app).toBeDefined();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.any(Object),
        constsMock.LOG_MESSAGES.STARTUP_LOG_FAILED,
      );
    });

    it("should call Actor.pushData with a valid startup record in production", async () => {
      await setupProductionLifecycle();
      await drainAutoInit();

      expect(apifyMock.pushData).toHaveBeenCalledWith(
        expect.objectContaining({
          method: constsMock.HTTP_METHODS.SYSTEM,
          type: constsMock.LOG_TAGS.STARTUP,
          statusCode: constsMock.HTTP_STATUS.OK,
        }),
      );
      expect(loggerMock.info).toHaveBeenCalledWith(
        LOG_MESSAGES.STARTUP_COMPLETE,
      );
    });

    it("should close the HTTP server and run finalCleanup during a production shutdown", async () => {
      freshMain = await setupProductionLifecycle();
      await drainAutoInit();

      await freshMain?.shutdown(constsMock.SHUTDOWN_SIGNALS.TEST_COMPLETE);
      expect(webhookManagerMock.persist).toHaveBeenCalled();
    });

    it("should close the HTTP server and drain active connections during production shutdown", async () => {
      freshMain = await setupProductionLifecycle();
      await drainAutoInit();

      await freshMain?.shutdown(constsMock.SHUTDOWN_SIGNALS.TEST_COMPLETE);
      expect(freshMain?.server).toBeDefined();
      expect(freshMain?.server?.closeAllConnections).toHaveBeenCalled();
      expect(freshMain?.server?.close).toHaveBeenCalled();
    });

    it("should call systemExit(FAILURE) when the testAndExit shutdown itself throws persistently", async () => {
      try {
        process.env[ENV_VARS.INPUT] = JSON.stringify({ testAndExit: true });

        syncServiceMock.stop.mockRejectedValue(
          assertType(new Error("Persistent stop failure")),
        );

        freshMain = await setupProductionLifecycle();
        await drainAutoInit();

        expect(freshMain?.app).toBeDefined();

        const TICKS = 50;
        jest.advanceTimersByTime(
          constsMock.APP_CONSTS.STARTUP_TEST_EXIT_DELAY_MS,
        );
        await flushPromises(TICKS);

        expect(systemMock.exit).toHaveBeenCalledWith(
          constsMock.EXIT_CODES.FAILURE,
        );
      } finally {
        delete process.env[ENV_VARS.INPUT];
        syncServiceMock.stop.mockResolvedValue(assertType(undefined));
      }
    });

    it("should log an error when the cleanup interval fires and webhookManager.cleanup() rejects", async () => {
      jest
        .mocked(webhookManagerMock.cleanup)
        .mockRejectedValueOnce(new Error("Cleanup Failed"));

      await setupProductionLifecycle();
      await drainAutoInit();

      jest.advanceTimersByTime(constsMock.APP_CONSTS.CLEANUP_INTERVAL_MS);
      await flushPromises();

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        constsMock.LOG_MESSAGES.CLEANUP_ERROR,
      );
    });

    it("should invoke webhookManager.cleanup() each time the cleanup interval fires", async () => {
      await setupProductionLifecycle();
      await drainAutoInit();

      jest.mocked(webhookManagerMock.cleanup).mockClear();
      const cleanupIntervalMultiplier = 2;
      jest.advanceTimersByTime(
        constsMock.APP_CONSTS.CLEANUP_INTERVAL_MS * cleanupIntervalMultiplier,
      );
      await flushPromises();

      expect(webhookManagerMock.cleanup).toHaveBeenCalledTimes(
        cleanupIntervalMultiplier,
      );
    });

    it("should listen on ACTOR_WEB_SERVER_PORT when the env var is set", async () => {
      const origPort = process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT];
      try {
        const port = "9999";
        process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT] = port;

        await setupProductionLifecycle();
        await drainAutoInit();

        expect(expressAppMock.listen).toHaveBeenCalledWith(
          port,
          expect.any(Function),
        );
      } finally {
        if (origPort !== undefined)
          process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT] = origPort;
        else delete process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT];
      }
    });

    it("should skip closeAllConnections and still close the server when the method is not available", async () => {
      // Server without closeAllConnections (older Node.js)
      /** @type {Server} */
      const legacyServer = assertType({
        listening: true,
        close: jest.fn((cb) => typeof cb === "function" && cb()),
        // closeAllConnections intentionally absent
      });
      expressAppMock.listen.mockImplementationOnce(
        assertType(
          /**
           * @param {number} _port
           * @param {(error?: Error) => void} cb
           * @returns {Server}
           */
          (_port, cb) => {
            if (typeof cb === "function") cb();
            return legacyServer;
          },
        ),
      );
      await jest.isolateModulesAsync(async () => {
        const freshMain = await getFreshMain();
        await drainAutoInit();

        await freshMain.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
        expect(legacyServer.close).toHaveBeenCalled();
        expect(webhookManagerMock.persist).toHaveBeenCalled();
      });
    });

    it("should run finalCleanup without calling server.close() when server is not listening", async () => {
      /** @type {Server} */
      const stoppedServer = assertType({
        listening: false, // server exists but is not listening
        close: jest.fn(),
        closeAllConnections: jest.fn(),
      });
      expressAppMock.listen.mockImplementationOnce(
        assertType(
          /**
           * @param {number} _port
           * @param {(error?: Error) => void} cb
           * @returns {Server}
           */
          (_port, cb) => {
            if (typeof cb === "function") cb();
            return stoppedServer;
          },
        ),
      );
      await jest.isolateModulesAsync(async () => {
        const freshMain = await getFreshMain();
        await drainAutoInit();

        await freshMain.shutdown(SHUTDOWN_SIGNALS.TEST_COMPLETE);
        expect(stoppedServer.close).not.toHaveBeenCalled();
        expect(webhookManagerMock.persist).toHaveBeenCalled();
      });
    });

    it("should stop the cleanup interval so webhookManager.cleanup() is not called after shutdown", async () => {
      const freshMain = await setupProductionLifecycle();
      await drainAutoInit();

      await freshMain?.shutdown(constsMock.SHUTDOWN_SIGNALS.TEST_COMPLETE);

      const cleanupIntervalMultiplier = 3;
      jest.mocked(webhookManagerMock.cleanup).mockClear();
      jest.advanceTimersByTime(
        constsMock.APP_CONSTS.CLEANUP_INTERVAL_MS * cleanupIntervalMultiplier,
      );
      await flushPromises();
      expect(webhookManagerMock.cleanup).not.toHaveBeenCalled();
    });
  });
});
