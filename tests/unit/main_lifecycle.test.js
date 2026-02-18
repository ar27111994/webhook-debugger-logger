/**
 * @file tests/unit/main_lifecycle.test.js
 * @description Unit tests for app lifecycle management (SIGINT, SIGTERM, migration) in main.js.
 */
import { createRequire } from "module";
import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { assertType } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import("../setup/helpers/shared-mocks.js").loggerMock} LoggerMock
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("../../src/typedefs.js").ActorInput} ActorInput
 */

// Test constants to avoid magic numbers, deriving from APP_CONSTS where possible
const DEFAULT_RETRY_DELAY = 500;
const DEFAULT_HEARTBEAT_INTERVAL = 30000;

const TEST_TIMEOUTS = Object.freeze({
  SHORT_DELAY: 100,
  MEDIUM_DELAY: 500,
  RETRY_DELAY: DEFAULT_RETRY_DELAY,
  ADVANCE_BUFFER: 1000,
  MAX_WAIT_ITERATIONS: 50,
  TICK_INTERVAL: 10,
  SSE_HEARTBEAT: DEFAULT_HEARTBEAT_INTERVAL,
});

const TEST_LIMITS = Object.freeze({
  RETRY_ATTEMPTS_TWO: 2,
  RETRY_ATTEMPTS_THREE: 3,
  RETRY_ATTEMPTS_FIVE: 5,
  MEMORY_LIMIT_48MB: 48,
  MEMORY_LIMIT_2GB: 2048,
  RATE_LIMIT_MAX_ENTRIES: 10000,
});

describe("Main.js Lifecycle Limits", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  const runWrappedImport =
    /**
     * @param {function({
     *   Actor?: any,
     *   listeners?: any[],
     *   exitSpy?: any,
     *   loggerMock?: any,
     *   expressAppMock?: any,
     *   webhookManagerMock?: any,
     *   sseHeartbeat?: any,
     *   HTTP_STATUS?: any,
     *   STARTUP_TEST_EXIT_DELAY_MS?: any,
     *   createMockRequest?: any,
     *   createMockResponse?: any,
     *   createMockNextFunction?: any,
     *   LOG_MESSAGES?: any,
     *   APP_CONSTS?: any,
     *   ENV_VALUES?: any,
     *   ENV_VARS?: any,
     *   SHUTDOWN_SIGNALS?: any,
     *   APP_ROUTES?: any,
     *   SIGNATURE_PROVIDERS?: any,
     *   MIME_TYPES?: any,
     * }): Promise<void>} fn
     * @param {function(): Promise<void>} [testSetup]
     */
    async (fn, testSetup) => {
      await jest.isolateModulesAsync(async () => {
        const {
          HTTP_STATUS,
          APP_CONSTS,
          LOG_MESSAGES,
          ENV_VALUES,
          SHUTDOWN_SIGNALS,
          APP_ROUTES,
          ENV_VARS,
          MIME_TYPES,
        } = await import(`../../src/consts/index.js`);
        const { SIGNATURE_PROVIDERS } = await import(
          `../../src/consts/security.js`
        );

        // Setup environment
        process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
        process.env[ENV_VARS.ACTOR_WEB_SERVER_PORT] = String(
          APP_CONSTS.DEFAULT_PORT,
        );

        // Initialize listeners array
        /** @type {Array<{event: string, handler: function(): void}>} */
        const listeners = [];

        // Mock system.js
        const exitMock = jest.fn();
        const onMock = jest.fn(
          /**
           * @param {string} event
           * @param {function(): void} handler
           */
          (event, handler) => {
            listeners.push({ event, handler });
          },
        );

        // Use unstable_mockModule which works with ESM isolateModules
        jest.unstable_mockModule("../../src/utils/system.js", () => ({
          exit: exitMock,
          on: onMock,
        }));

        // Mock dependencies - Import setupCommonMocks LOCALLY to affect inner registry
        const { setupCommonMocks } =
          await import("../setup/helpers/mock-setup.js");
        const {
          createMockRequest,
          createMockResponse,
          createMockNextFunction,
        } = await import("../setup/helpers/test-utils.js");

        await setupCommonMocks({
          logger: true,
          apify: true,
          axios: true,
          sync: true,
          db: true,
          webhookManager: true,
          config: true,
          routes: true,
          middleware: true,
          bootstrap: true,
          hotReload: true,
          rateLimit: true,
          auth: true,
          events: true,
          // consts: true, // Use real constants to match main.js which imports consts/app.js directly
          express: true,
          appState: true,
          loggerMiddleware: true,
        });

        const { expressAppMock, webhookManagerMock, loggerMock } =
          await import("../setup/helpers/shared-mocks.js");

        if (testSetup) {
          await testSetup();
        }

        // Import main
        const main = await import(`../../src/main.js`);

        try {
          await fn({
            Actor: (await import("apify")).Actor,
            listeners,
            exitSpy: exitMock,
            loggerMock,
            expressAppMock,
            webhookManagerMock,
            sseHeartbeat: main.sseHeartbeat,
            HTTP_STATUS,
            createMockRequest,
            createMockResponse,
            createMockNextFunction,
            LOG_MESSAGES,
            APP_CONSTS,
            ENV_VALUES,
            ENV_VARS,
            SHUTDOWN_SIGNALS,
            APP_ROUTES,
            SIGNATURE_PROVIDERS,
            MIME_TYPES,
          });
        } catch (e) {
          if (
            /** @type {Error} */ (e).message ===
            LOG_MESSAGES.SERVER_START_FAILED &&
            testSetup
          ) {
            // Expected failure for init tests
            return;
          }
          throw e;
        }
      });
    };

  test("should handle SIGTERM signal", async () => {
    await runWrappedImport(
      async ({
        listeners,
        loggerMock,
        LOG_MESSAGES,
        Actor,
        SHUTDOWN_SIGNALS,
      }) => {
        const listener = Array.isArray(listeners)
          ? listeners.find((l) => l.event === SHUTDOWN_SIGNALS.SIGTERM)
          : undefined;
        const handler = listener.handler;

        // Trigger
        handler();

        // Wait for async operations and any retry delays
        await jest.advanceTimersByTimeAsync(TEST_TIMEOUTS.MEDIUM_DELAY);

        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ signal: SHUTDOWN_SIGNALS.SIGTERM }),
          LOG_MESSAGES.SHUTDOWN_START,
        );
        expect(Actor.exit).toHaveBeenCalled();
      },
      async () => {
        jest.useFakeTimers();
      },
    );
  });

  test("should handle SIGINT shutdown", async () => {
    await runWrappedImport(
      async ({
        Actor,
        listeners,
        loggerMock,
        SHUTDOWN_SIGNALS,
        LOG_MESSAGES,
      }) => {
        const listener = Array.isArray(listeners)
          ? listeners.find((l) => l.event === SHUTDOWN_SIGNALS.SIGINT)
          : undefined;
        expect(listener).toBeDefined();

        const handler = listener.handler;
        handler();

        // Wait for async operations
        await jest.advanceTimersByTimeAsync(TEST_TIMEOUTS.MEDIUM_DELAY);

        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ signal: SHUTDOWN_SIGNALS.SIGINT }),
          LOG_MESSAGES.SHUTDOWN_START,
        );
        expect(Actor.exit).toHaveBeenCalled();
      },
      async () => {
        jest.useFakeTimers();
      },
    );
  });

  test("should handle Apify migration event", async () => {
    await runWrappedImport(
      async ({ Actor, loggerMock, SHUTDOWN_SIGNALS, LOG_MESSAGES }) => {
        const calls = Actor.on.mock.calls;
        const call = calls.find(
          /**
           * @param {Array<string | function(): void>} c
           * @returns {boolean}
           */
          (c) => c[0] === "migrating",
        );
        expect(call).toBeDefined();

        const handler = call[1];
        await handler();

        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ signal: SHUTDOWN_SIGNALS.MIGRATING }),
          LOG_MESSAGES.SHUTDOWN_START,
        );
        expect(Actor.exit).toHaveBeenCalled();
      },
    );
  });

  test("should handle Apify aborting event", async () => {
    await runWrappedImport(
      async ({ Actor, loggerMock, SHUTDOWN_SIGNALS, LOG_MESSAGES }) => {
        const calls = Actor.on.mock.calls;
        const call = calls.find(
          /**
           * @param {Array<string | function(): void>} c
           * @returns {boolean}
           */
          (c) => c[0] === "aborting",
        );
        expect(call).toBeDefined();

        const handler = call[1];
        await handler();

        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ signal: SHUTDOWN_SIGNALS.ABORTING }),
          LOG_MESSAGES.SHUTDOWN_START,
        );
        expect(Actor.exit).toHaveBeenCalled();
      },
    );
  });

  test("should handle Actor.init failure", async () => {
    await runWrappedImport(
      async ({ exitSpy, loggerMock, LOG_MESSAGES }) => {
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.anything(),
          LOG_MESSAGES.SERVER_START_FAILED,
        );
      },
      async () => {
        const { Actor } = await import("apify");
        jest.mocked(Actor.init).mockRejectedValue(new Error("Init failed"));
      },
    );
  });

  test("should handle app.listen failure (port conflict)", async () => {
    await runWrappedImport(
      async ({ exitSpy, loggerMock, LOG_MESSAGES }) => {
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.anything(),
          LOG_MESSAGES.SERVER_START_FAILED,
        );
      },
      async () => {
        const { expressAppMock } =
          await import("../setup/helpers/shared-mocks.js");
        expressAppMock.listen.mockImplementation(() => {
          throw new Error("EADDRINUSE");
        });
      },
    );
  });

  test("should force exit if shutdown times out", async () => {
    await runWrappedImport(
      async ({
        listeners,
        exitSpy,
        loggerMock,
        APP_CONSTS,
        LOG_MESSAGES,
        SHUTDOWN_SIGNALS,
      }) => {
        const { webhookManagerMock } =
          await import("../setup/helpers/shared-mocks.js");
        // Make persist hang indefinitely so timeout triggers
        jest
          .mocked(webhookManagerMock.persist)
          .mockImplementation(() => new Promise(() => { }));

        const listener = Array.isArray(listeners)
          ? listeners.find((l) => l.event === SHUTDOWN_SIGNALS.SIGTERM)
          : undefined;
        const handler = listener.handler;

        // Trigger shutdown but don't await it yet (it waits for finalCleanup or force exit)
        handler();

        // Advance time enough to trigger SHUTDOWN_TIMEOUT_MS
        await jest.advanceTimersByTimeAsync(
          APP_CONSTS.SHUTDOWN_TIMEOUT_MS + TEST_TIMEOUTS.ADVANCE_BUFFER,
        );

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(loggerMock.error).toHaveBeenCalledWith(
          LOG_MESSAGES.FORCE_SHUTDOWN,
        );
      },
      async () => {
        jest.useFakeTimers();
      },
    );
  });

  test("should verify Actor mocks work in isolation", async () => {
    await runWrappedImport(
      async ({ Actor }) => {
        expect(Actor.isAtHome()).toBe(true);
      },
      async () => {
        const { Actor } = await import("apify");
        jest.mocked(Actor.isAtHome).mockReturnValue(true);
      },
    );
  });

  /**
   * @param {LoggerMock} loggerMock
   */
  const waitForInitialization = async (loggerMock) => {
    for (let i = 0; i < TEST_TIMEOUTS.MAX_WAIT_ITERATIONS; i++) {
      await jest.runAllTicks();
      const calls = loggerMock.info.mock.calls.map(
        /** @param {any[]} c */
        (c) => c[1] || c[0],
      );
      if (
        calls.some(
          /** @param {any} msg */
          (msg) => typeof msg === "string" && msg.includes("initialized"),
        )
      ) {
        return;
      }
      await jest.advanceTimersByTimeAsync(TEST_TIMEOUTS.TICK_INTERVAL);
    }
  };

  test("should handle testAndExit mode", async () => {
    await runWrappedImport(
      async ({ APP_CONSTS, loggerMock, SHUTDOWN_SIGNALS, LOG_MESSAGES }) => {
        const delay = APP_CONSTS.STARTUP_TEST_EXIT_DELAY_MS;
        const SHUTDOWN_DELAY_MULTIPLIER = 2;

        await waitForInitialization(loggerMock);

        // Advancing timers should trigger TESTANDEXIT shutdown
        await jest.advanceTimersByTimeAsync(delay * SHUTDOWN_DELAY_MULTIPLIER);
        // Trigger microtasks
        await jest.runAllTicks();
        // Since shutdown is async, advance one more bit if needed
        await jest.advanceTimersByTimeAsync(TEST_TIMEOUTS.SHORT_DELAY);

        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ signal: SHUTDOWN_SIGNALS.TESTANDEXIT }),
          LOG_MESSAGES.SHUTDOWN_START,
        );
      },
      async () => {
        const { Actor } = await import("apify");
        jest.mocked(Actor.getInput).mockResolvedValue({ testAndExit: true });
        jest.useFakeTimers();
      },
    );
  });

  test("should parse INPUT env var when not at home", async () => {
    await runWrappedImport(
      async ({ loggerMock, LOG_MESSAGES }) => {
        await waitForInitialization(loggerMock);

        const { configMock } = await import("../setup/helpers/shared-mocks.js");
        expect(configMock.parseWebhookOptions).toHaveBeenCalledWith(
          expect.objectContaining({ foo: "bar" }),
        );
        expect(loggerMock.info).toHaveBeenCalledWith(
          LOG_MESSAGES.INPUT_ENV_VAR_PARSED,
        );
      },
      async () => {
        const { Actor } = await import("apify");
        const { ENV_VARS } = await import("../../src/consts/app.js");
        jest.mocked(Actor.isAtHome).mockReturnValue(false);
        process.env[ENV_VARS.INPUT] = JSON.stringify({ foo: "bar" });
      },
    );
  });

  describe("Helper Callbacks & Middleware", () => {
    test("should implement status override middleware", async () => {
      await runWrappedImport(
        async ({
          expressAppMock,
          createMockRequest,
          createMockResponse,
          createMockNextFunction,
          HTTP_STATUS,
          APP_ROUTES,
        }) => {
          // There are two calls to app.all("/webhook/:id")
          // 1. app.all(..., ingestMiddleware) -> 2 args
          // 2. app.all(..., statusMiddleware, loggingMiddleware) -> 3 args
          const MIDDLEWARE_CHAIN_LENGTH = 3;
          const call = expressAppMock.all.mock.calls.find(
            /**
             * @param {Array<string | function(): void>} args
             * @returns {boolean}
             */
            (args) =>
              args[0] === APP_ROUTES.WEBHOOK &&
              args.length === MIDDLEWARE_CHAIN_LENGTH,
          );
          expect(call).toBeDefined();

          const middleware = call[1];
          expect(typeof middleware).toBe("function");

          const req = createMockRequest({
            query: { __status: HTTP_STATUS.CREATED.toString() },
          });
          const res = createMockResponse();
          const next = createMockNextFunction();
          middleware(req, res, next);

          expect(req.forcedStatus).toBe(HTTP_STATUS.CREATED);
          expect(next).toHaveBeenCalled();

          // Test invalid status
          req.forcedStatus = undefined;
          req.query.__status = "999";
          middleware(req, res, next);
          expect(req.forcedStatus).toBeUndefined();
        },
      );
    });

    test("should register info routes with correct dependencies", async () => {
      await runWrappedImport(async ({ webhookManagerMock, APP_CONSTS }) => {
        const { createInfoHandler } = await import("../../src/routes/index.js");

        // Expect handler creation to be called with correct deps
        const calls = jest.mocked(createInfoHandler).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        const infoDeps = calls[0][0];

        expect(infoDeps.webhookManager).toBe(webhookManagerMock);
        expect(infoDeps.getAuthKey()).toBe(""); // Default mock state
        expect(infoDeps.getRetentionHours()).toBe(
          APP_CONSTS.DEFAULT_RETENTION_HOURS,
        );
        expect(infoDeps.getMaxPayloadSize()).toBe(
          APP_CONSTS.DEFAULT_PAYLOAD_LIMIT,
        );
      });
    });

    test("should pass correct callbacks to route factories", async () => {
      await runWrappedImport(async ({ APP_CONSTS, SIGNATURE_PROVIDERS }) => {
        const {
          createInfoHandler,
          createDashboardHandler,
          createReplayHandler,
        } = await import("../../src/routes/index.js");

        // --- Info Handler ---
        expect(createInfoHandler).toHaveBeenCalled();
        const infoDeps = jest.mocked(createInfoHandler).mock.calls[0][0];

        expect(infoDeps.getAuthKey()).toBe(""); // Default mock state
        expect(infoDeps.getRetentionHours()).toBe(
          APP_CONSTS.DEFAULT_RETENTION_HOURS,
        );
        expect(infoDeps.getMaxPayloadSize()).toBe(
          APP_CONSTS.DEFAULT_PAYLOAD_LIMIT,
        );

        // Setup mock state for assertions
        const { appStateMock, loggerMiddlewareMock } =
          await import("../setup/helpers/shared-mocks.js");
        appStateMock.authKey = "test-key";
        appStateMock.retentionHours = TEST_LIMITS.MEMORY_LIMIT_48MB;
        appStateMock.maxPayloadSize = TEST_LIMITS.MEMORY_LIMIT_2GB;

        expect(infoDeps.getAuthKey()).toBe("test-key");
        expect(infoDeps.getRetentionHours()).toBe(
          TEST_LIMITS.MEMORY_LIMIT_48MB,
        );
        expect(infoDeps.getMaxPayloadSize()).toBe(TEST_LIMITS.MEMORY_LIMIT_2GB);

        // --- Dashboard Handler ---
        expect(createDashboardHandler).toHaveBeenCalled();
        const dashDeps = jest.mocked(createDashboardHandler).mock.calls[0][0];

        // Test getTemplate
        await dashDeps.getTemplate();

        // Test getSignatureStatus
        // Default is null
        expect(dashDeps.getSignatureStatus()).toBeNull();

        // Test getSignatureStatus logic
        Object.assign(loggerMiddlewareMock.options, {
          signatureVerification: {
            provider: SIGNATURE_PROVIDERS.GITHUB,
            secret: "xyz",
          },
        });
        expect(dashDeps.getSignatureStatus()).toBe(
          SIGNATURE_PROVIDERS.GITHUB.toUpperCase(),
        );

        Object.assign(loggerMiddlewareMock.options, {
          signatureVerification: null,
        });
        expect(dashDeps.getSignatureStatus()).toBeNull();

        // Test setTemplate (Line 402 coverage)
        const newTemplate = "<html>new</html>";
        dashDeps.setTemplate(newTemplate);
        expect(dashDeps.getTemplate()).toBe(newTemplate);

        // --- Replay Handler ---
        expect(createReplayHandler).toHaveBeenCalled();
        const replayDeps = jest.mocked(createReplayHandler).mock.calls[0];
        const getMaxRetries = replayDeps[0];
        const getTimeout = replayDeps[1];

        expect(typeof getMaxRetries).toBe("function");
        expect(typeof getTimeout).toBe("function");
        // These return undefined from mock appState usually, or defaults
        expect(getMaxRetries?.()).toBeUndefined();
        expect(getTimeout?.()).toBeUndefined();

        appStateMock.replayMaxRetries = TEST_LIMITS.RETRY_ATTEMPTS_FIVE;
        appStateMock.replayTimeoutMs = TEST_TIMEOUTS.SSE_HEARTBEAT;

        expect(getMaxRetries?.()).toBe(TEST_LIMITS.RETRY_ATTEMPTS_FIVE);
        expect(getTimeout?.()).toBe(TEST_TIMEOUTS.SSE_HEARTBEAT);
      });
    });

    test("should handle SSE heartbeat interval", async () => {
      await runWrappedImport(
        async ({ sseHeartbeat }) => {
          expect(sseHeartbeat).toBeDefined();
          // It should be a Timeout/Interval object (Node.js)
          expect(sseHeartbeat).toHaveProperty("unref");
          expect(typeof sseHeartbeat.unref).toBe("function");
          // Calling it shouldn't throw
          expect(() => sseHeartbeat.unref()).not.toThrow();
        },
        async () => {
          // No special setup
        },
      );
    });
    test("should retry shutdown on failure", async () => {
      await runWrappedImport(
        async ({
          listeners,
          loggerMock,
          webhookManagerMock,
          LOG_MESSAGES,
          SHUTDOWN_SIGNALS,
        }) => {
          // Mock persist to fail twice then succeed
          // This simulates shutdown() failure since shutdown calls persist
          jest
            .mocked(webhookManagerMock.persist)
            .mockRejectedValueOnce(new Error("Persist Fail 1"))
            .mockRejectedValueOnce(new Error("Persist Fail 2"))
            .mockResolvedValue(undefined);

          const listener = Array.isArray(listeners)
            ? listeners.find((l) => l.event === SHUTDOWN_SIGNALS.SIGTERM)
            : undefined;
          const handler = listener.handler;

          // Trigger shutdown
          handler();

          // Advance timers to trigger retries (SHUTDOWN_RETRY_DELAY_MS is usually small, e.g. 1000ms)
          const RetryDelay = TEST_TIMEOUTS.RETRY_DELAY; // Mocked constant value if possible, or just advance enough

          // Retry 1
          await jest.advanceTimersByTimeAsync(RetryDelay);
          // Retry 2
          await jest.advanceTimersByTimeAsync(RetryDelay);

          expect(webhookManagerMock.persist).toHaveBeenCalledTimes(
            TEST_LIMITS.RETRY_ATTEMPTS_THREE,
          );
          expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({ attempts: expect.any(Number) }),
            LOG_MESSAGES.SHUTDOWN_RETRY,
          );
          // Eventually succeeds, so Actor.exit should be called
          const { Actor } = await import("apify");
          expect(Actor.exit).toHaveBeenCalled();
        },
        async () => {
          jest.useFakeTimers();
        },
      );
    });

    test("should force exit if retries exhausted", async () => {
      await runWrappedImport(
        async ({
          listeners,
          exitSpy,
          loggerMock,
          webhookManagerMock,
          LOG_MESSAGES,
          SHUTDOWN_SIGNALS,
        }) => {
          // Fail forever
          jest
            .mocked(webhookManagerMock.persist)
            .mockRejectedValue(new Error("Persist Forever Fail"));

          const listener = Array.isArray(listeners)
            ? listeners.find((l) => l.event === SHUTDOWN_SIGNALS.SIGTERM)
            : undefined;
          const handler = listener.handler;

          handler();

          // Convert max attempts * delay
          // Advance enough time for all retries to exhaust
          const totalRetryTime =
            TEST_LIMITS.RETRY_ATTEMPTS_THREE * TEST_TIMEOUTS.RETRY_DELAY +
            TEST_TIMEOUTS.ADVANCE_BUFFER;
          await jest.advanceTimersByTimeAsync(totalRetryTime);

          expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Object) }),
            LOG_MESSAGES.SHUTDOWN_FAILED_AFTER_RETRIES,
          );
          expect(exitSpy).toHaveBeenCalledWith(1);
        },
        async () => {
          jest.useFakeTimers();
        },
      );
    });

    test("should handle scaling up when partial webhooks exist", async () => {
      await runWrappedImport(
        async ({ webhookManagerMock, loggerMock, LOG_MESSAGES }) => {
          // Trigger logic: active.length < urlCount && active.length > 0
          expect(loggerMock.info).toHaveBeenCalledWith(
            expect.objectContaining({ count: 1 }),
            LOG_MESSAGES.SCALING_UP,
          );
          expect(webhookManagerMock.generateWebhooks).toHaveBeenCalledWith(
            1,
            expect.anything(),
          );
        },
        async () => {
          const { Actor } = await import("apify");
          const { webhookManagerMock } =
            await import("../setup/helpers/shared-mocks.js");

          jest.mocked(Actor.getInput).mockResolvedValue({ urlCount: 2 });
          // Mock 1 active webhook with valid shape
          jest
            .mocked(webhookManagerMock.getAllActive)
            .mockReturnValue([
              { id: "1", expiresAt: new Date().toISOString() },
            ]);
        },
      );
    });

    test("should configure compression filter correctly", async () => {
      /** @typedef {{filter: (req: any, res: any) => boolean}} CompressionOptions */

      await runWrappedImport(
        async ({ APP_ROUTES, MIME_TYPES }) => {
          const imported = await import("compression");
          /** @type {jest.Mock} */
          const compressionMock = assertType(imported.default);
          expect(compressionMock).toHaveBeenCalled();

          // Extract filter function passed to compression
          /** @type {CompressionOptions} */
          const opts = assertType(compressionMock.mock.calls[0][0]);
          expect(opts).toBeDefined();
          const filter = opts.filter;
          expect(typeof filter).toBe("function");

          // Helpers
          /**
           * @param {string} path
           * @param {Record<string, string>} [headers]
           */
          const mockReq = (path, headers = {}) => ({ path, headers });
          const mockRes = {};

          // 1. Should return false for LOG_STREAM path
          expect(filter(mockReq(APP_ROUTES.LOG_STREAM), mockRes)).toBe(false);

          // 2. Should return false for EVENT_STREAM header
          expect(
            filter(
              mockReq("/any", {
                accept: String(MIME_TYPES.EVENT_STREAM),
              }),
              mockRes,
            ),
          ).toBe(false);

          // 3. Should delegate to default filter for other requests
          filter(mockReq("/other"), mockRes);
          // Access filter prop on mock - strictly casting to avoid TS error
          expect(assertType(compressionMock).filter).toHaveBeenCalled();
        },
        async () => {
          // Mock compression module
          /** @type {jest.Mocked<CompressionOptions>} */
          const compressionFn = assertType(jest.fn());
          // Attach fail-through filter method to the mock function itself
          compressionFn.filter = jest.fn(() => true);
          jest.unstable_mockModule("compression", () => ({
            default: compressionFn,
          }));
        },
      );
    });
  });

  describe("Branch Coverage & Edge Cases", () => {
    test("should use NPM_PACKAGE_VERSION env var if present", async () => {
      await runWrappedImport(
        async () => {
          const { createDashboardHandler } =
            await import("../../src/routes/index.js");
          expect(createDashboardHandler).toHaveBeenCalledWith(
            expect.objectContaining({ version: "1.2.3-test" }),
          );
        },
        async () => {
          const { ENV_VARS } = await import("../../src/consts/app.js");
          process.env[ENV_VARS.NPM_PACKAGE_VERSION] = "1.2.3-test";
        },
      );
    });

    test("should use package.json version if env var missing", async () => {
      await runWrappedImport(
        async () => {
          const { createDashboardHandler } =
            await import("../../src/routes/index.js");
          const { APP_CONSTS } = await import("../../src/consts/app.js");
          expect(createDashboardHandler).toHaveBeenCalledWith(
            expect.objectContaining({
              version: expect.not.stringMatching(APP_CONSTS.UNKNOWN),
            }),
          );
        },
        async () => {
          const { ENV_VARS } = await import("../../src/consts/app.js");
          delete process.env[ENV_VARS.NPM_PACKAGE_VERSION];
        },
      );
    });

    test("should default to empty object if Actor.getInput returns null", async () => {
      await runWrappedImport(
        async ({ webhookManagerMock }) => {
          expect(webhookManagerMock.init).toHaveBeenCalled();
        },
        async () => {
          const { Actor } = await import("apify");
          jest.mocked(Actor.getInput).mockResolvedValue(null);
        },
      );
    });

    test("should disable JSON parsing middleware if config.enableJSONParsing is false", async () => {
      await runWrappedImport(
        async () => {
          const { createJsonParserMiddleware } =
            await import("../../src/middleware/index.js");
          expect(createJsonParserMiddleware).not.toHaveBeenCalled();
        },
        async () => {
          const { Actor } = await import("apify");
          jest.mocked(Actor.getInput).mockResolvedValue({
            enableJSONParsing: false,
          });
        },
      );
    });

    test("should capture clients set and handle heartbeat errors", async () => {
      /** @type {Set<ServerResponse> | undefined} */
      let capturedClients;
      await runWrappedImport(
        async () => {
          expect(capturedClients).toBeDefined();
          /** @type {ServerResponse} */
          const failingRes = assertType({
            write: jest.fn(() => {
              throw new Error("Write failed");
            }),
          });
          capturedClients?.add(failingRes);

          // Advance time to trigger heartbeat
          await jest.advanceTimersByTimeAsync(
            TEST_TIMEOUTS.SSE_HEARTBEAT + TEST_TIMEOUTS.SHORT_DELAY,
          );

          expect(failingRes.write).toHaveBeenCalled();
          if (capturedClients) {
            expect(capturedClients.has(failingRes)).toBe(false); // Should be deleted
          }
        },
        async () => {
          jest.useFakeTimers();
          const { createBroadcaster } =
            await import("../../src/routes/index.js");
          jest.mocked(createBroadcaster).mockImplementation((clients) => {
            capturedClients = clients;
            return jest.fn();
          });
        },
      );
    });

    test("should default to APP_CONSTS.UNKNOWN if version info is missing", async () => {
      await runWrappedImport(
        async () => {
          const { createDashboardHandler } =
            await import("../../src/routes/index.js");
          const { APP_CONSTS } = await import("../../src/consts/app.js");
          expect(createDashboardHandler).toHaveBeenCalledWith(
            expect.objectContaining({ version: APP_CONSTS.UNKNOWN }),
          );
        },
        async () => {
          const { ENV_VARS } = await import("../../src/consts/app.js");
          delete process.env[ENV_VARS.NPM_PACKAGE_VERSION];

          // Use real require to load the actual configuration files for the mock
          const requireUtils = createRequire(import.meta.url);
          const realInputSchema = requireUtils(
            "../../.actor/input_schema.json",
          );
          const realActorJson = requireUtils("../../.actor/actor.json");

          // Mock module.createRequire to simulate missing package.json version
          // We intercept the createRequire call to return the REAL config files we loaded above.
          const requireMock = jest.fn(
            /** @param {string} id */
            (id) => {
              if (id.endsWith("package.json")) return {}; // Still stub package.json for version test
              if (id.endsWith("input_schema.json")) return realInputSchema;
              if (id.endsWith("actor.json")) return realActorJson;
              return {};
            },
          );
          jest.unstable_mockModule("module", () => ({
            createRequire: () => requireMock,
          }));
        },
      );
    });

    test("should use default enableJSONParsing=true if config undefined", async () => {
      await runWrappedImport(
        async () => {
          const { createJsonParserMiddleware } =
            await import("../../src/middleware/index.js");
          expect(createJsonParserMiddleware).toHaveBeenCalled();
        },
        async () => {
          // Mock parseWebhookOptions to return object without enableJSONParsing
          jest.unstable_mockModule("../../src/utils/config.js", () => ({
            parseWebhookOptions: () => ({}), // Empty config
            normalizeInput:
              /** @param {ActorInput} i */
              (i) => i,
          }));
        },
      );
    });

    test("should handle missing sseHeartbeat.unref gracefully", async () => {
      // Logic: if (sseHeartbeat.unref) sseHeartbeat.unref();
      // We want to test the case where unref is MISSING.
      await runWrappedImport(
        async () => {
          // Verify that execution completes without throwing when unref is missing
          // The test passes if no error is thrown during import execution
          expect(true).toBe(true);
        },
        async () => {
          jest.useFakeTimers();
          // Mock setInterval to return object WITHOUT unref
          jest.spyOn(global, "setInterval").mockReturnValue(
            assertType({ ref: jest.fn() }), // Missing unref
          );
        },
      );
    });
  });
});
