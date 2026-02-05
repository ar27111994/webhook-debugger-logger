/**
 * @file tests/unit/main_lifecycle.test.js
 * @description Unit tests for app lifecycle management (SIGINT, SIGTERM, migration) in main.js.
 */
import { jest } from "@jest/globals";
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
     * }): Promise<void>} fn
     * @param {function(): Promise<void>} [testSetup]
     */
    async (fn, testSetup) => {
      await jest.isolateModulesAsync(async () => {
        // Setup environment
        process.env.NODE_ENV = "production";
        process.env.ACTOR_WEB_SERVER_PORT = "8080";

        const originalOn = process.on;
        /** @type {Array<{event: string, handler: function(): void}>} */
        const listeners = [];
        const manualOn =
          /**
           * @param {string} event
           * @param {function(): void} handler
           * @returns {NodeJS.Process}
           */
          (event, handler) => {
            listeners.push({ event, handler });
            return process;
          };

        const {
          assertType,
          createMockRequest,
          createMockResponse,
          createMockNextFunction,
        } = await import("../setup/helpers/test-utils.js");
        const { expressAppMock, webhookManagerMock, loggerMock } =
          await import("../setup/helpers/shared-mocks.js");

        const originalExit = process.exit;
        const manualExit = jest.fn();

        // Apply manual mocks
        process.on = manualOn;
        process.exit = assertType(manualExit);

        // Mock dependencies - Import setupCommonMocks LOCALLY to affect inner registry
        const { setupCommonMocks } =
          await import("../setup/helpers/mock-setup.js");
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
          events: true, // Used by main.js
          consts: true, // Used by main.js imports
          express: true, // Use shared express mock
          appState: true, // Use shared appState mock
          loggerMiddleware: true, // Use shared loggerMiddleware mock
        });

        if (testSetup) {
          await testSetup();
        }

        try {
          // Import main with cache bursting
          const cacheBust = Date.now();
          const main = await import(`../../src/main.js?t=${cacheBust}`);
          const { HTTP_STATUS, STARTUP_TEST_EXIT_DELAY_MS } = await import(
            `../../src/consts.js?t=${cacheBust}`
          );

          await fn({
            Actor: (await import("apify")).Actor,
            listeners,
            exitSpy: manualExit,
            loggerMock,
            expressAppMock,
            webhookManagerMock,
            sseHeartbeat: main.sseHeartbeat,
            HTTP_STATUS,
            STARTUP_TEST_EXIT_DELAY_MS,
            createMockRequest,
            createMockResponse,
            createMockNextFunction,
          });
        } catch (e) {
          if (
            /** @type {Error} */ (e).message === "Server failed to start" &&
            testSetup
          ) {
            // Expected failure for init tests
            return;
          }
          throw e;
        } finally {
          // Restore
          process.on = originalOn;
          process.exit = originalExit;
        }
      });
    };

  test("should handle SIGTERM shutdown", async () => {
    await runWrappedImport(async ({ Actor, listeners, loggerMock }) => {
      const listener = Array.isArray(listeners)
        ? listeners.find((l) => l.event === "SIGTERM")
        : undefined;
      expect(listener).toBeDefined();

      const handler = listener.handler;
      await handler();

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ signal: "SIGTERM" }),
        "Shutting down",
      );
      expect(Actor.exit).toHaveBeenCalled();
    });
  });

  test("should handle SIGINT shutdown", async () => {
    await runWrappedImport(async ({ Actor, listeners, loggerMock }) => {
      const listener = Array.isArray(listeners)
        ? listeners.find((l) => l.event === "SIGINT")
        : undefined;
      expect(listener).toBeDefined();

      const handler = listener.handler;
      await handler();

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ signal: "SIGINT" }),
        "Shutting down",
      );
      expect(Actor.exit).toHaveBeenCalled();
    });
  });

  test("should handle Apify migration event", async () => {
    await runWrappedImport(async ({ Actor, loggerMock }) => {
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
        expect.objectContaining({ signal: "MIGRATING" }),
        "Shutting down",
      );
      expect(Actor.exit).toHaveBeenCalled();
    });
  });

  test("should handle Apify aborting event", async () => {
    await runWrappedImport(async ({ Actor, loggerMock }) => {
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
        expect.objectContaining({ signal: "ABORTING" }),
        "Shutting down",
      );
      expect(Actor.exit).toHaveBeenCalled();
    });
  });

  test("should handle Actor.init failure", async () => {
    await runWrappedImport(
      async ({ exitSpy, loggerMock }) => {
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.anything(),
          "Server failed to start",
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
      async ({ exitSpy, loggerMock }) => {
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.anything(),
          "Server failed to start",
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
      async ({ listeners, exitSpy, loggerMock }) => {
        const { webhookManagerMock } =
          await import("../setup/helpers/shared-mocks.js");
        // Make persist hang indefinitely so timeout triggers
        jest
          .mocked(webhookManagerMock.persist)
          .mockImplementation(() => new Promise(() => {}));

        const listener = Array.isArray(listeners)
          ? listeners.find((l) => l.event === "SIGTERM")
          : undefined;
        const handler = listener.handler;

        // Trigger shutdown but don't await it yet (it waits for finalCleanup or force exit)
        handler();

        // Advance timers to trigger force exit
        const { constsMock } = await import("../setup/helpers/shared-mocks.js");

        // Advance time enough to trigger SHUTDOWN_TIMEOUT_MS
        await jest.advanceTimersByTimeAsync(
          constsMock.SHUTDOWN_TIMEOUT_MS + 100,
        );

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(loggerMock.error).toHaveBeenCalledWith(
          "Forceful shutdown after timeout",
        );
      },
      async () => {
        jest.useFakeTimers();
      },
    );
  });

  test("should handle testAndExit mode", async () => {
    await runWrappedImport(
      async ({ STARTUP_TEST_EXIT_DELAY_MS, loggerMock }) => {
        // Advancing timers should trigger TESTANDEXIT shutdown
        await jest.advanceTimersByTimeAsync(STARTUP_TEST_EXIT_DELAY_MS * 2);
        // Trigger microtasks
        await jest.runAllTicks();
        // Since shutdown is async, advance one more bit if needed
        await jest.advanceTimersByTimeAsync(100);

        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ signal: "TESTANDEXIT" }),
          "Shutting down",
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
      async ({ loggerMock }) => {
        const { configMock } = await import("../setup/helpers/shared-mocks.js");
        expect(configMock.parseWebhookOptions).toHaveBeenCalledWith(
          expect.objectContaining({ foo: "bar" }),
        );
        expect(loggerMock.info).toHaveBeenCalledWith(
          "Using override from INPUT environment variable",
        );
      },
      async () => {
        process.env.INPUT = JSON.stringify({ foo: "bar" });
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
        }) => {
          // There are two calls to app.all("/webhook/:id")
          // 1. app.all(..., ingestMiddleware) -> 2 args
          // 2. app.all(..., statusMiddleware, loggingMiddleware) -> 3 args
          const call = expressAppMock.all.mock.calls.find(
            /**
             * @param {Array<string | function(): void>} args
             * @returns {boolean}
             */
            (args) => args[0] === "/webhook/:id" && args.length === 3,
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

          expect(/** @type {any} */ (req).forcedStatus).toBe(
            HTTP_STATUS.CREATED,
          );
          expect(next).toHaveBeenCalled();

          // Test invalid status
          /** @type {any} */ (req).forcedStatus = undefined;
          req.query.__status = "999";
          middleware(req, res, next);
          expect(/** @type {any} */ (req).forcedStatus).toBeUndefined();
        },
      );
    });

    test("should pass correct callbacks to route factories", async () => {
      await runWrappedImport(async () => {
        const {
          createInfoHandler,
          createDashboardHandler,
          createReplayHandler,
        } = await import("../../src/routes/index.js");

        // --- Info Handler ---
        expect(createInfoHandler).toHaveBeenCalled();
        const infoDeps = jest.mocked(createInfoHandler).mock.calls[0][0];

        expect(infoDeps.getAuthKey()).toBe(""); // Default mock state
        expect(infoDeps.getRetentionHours()).toBe(24); // DEFAULT_RETENTION_HOURS
        expect(infoDeps.getMaxPayloadSize()).toBe(1000); // DEFAULT_PAYLOAD_LIMIT from constsMock

        // Setup mock state for assertions
        const { appStateMock, loggerMiddlewareMock } =
          await import("../setup/helpers/shared-mocks.js");
        /** @type {any} */ (appStateMock).authKey = "test-key";
        /** @type {any} */ (appStateMock).retentionHours = 48;
        /** @type {any} */ (appStateMock).maxPayloadSize = 2048;

        expect(infoDeps.getAuthKey()).toBe("test-key");
        expect(infoDeps.getRetentionHours()).toBe(48);
        expect(infoDeps.getMaxPayloadSize()).toBe(2048);

        // --- Dashboard Handler ---
        expect(createDashboardHandler).toHaveBeenCalled();
        const dashDeps = jest.mocked(createDashboardHandler).mock.calls[0][0];

        // Test getTemplate
        await dashDeps.getTemplate();

        // Test getSignatureStatus
        // Default is null
        expect(dashDeps.getSignatureStatus()).toBeNull();

        // Test getSignatureStatus logic
        /** @type {any} */ (loggerMiddlewareMock).options = {
          signatureVerification: { provider: "github", secret: "xyz" },
        };
        expect(dashDeps.getSignatureStatus()).toBe("GITHUB");

        /** @type {any} */ (loggerMiddlewareMock).options = {
          signatureVerification: null,
        };
        expect(dashDeps.getSignatureStatus()).toBeNull();

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

        /** @type {any} */ (appStateMock).replayMaxRetries = 5;
        /** @type {any} */ (appStateMock).replayTimeoutMs = 5000;

        expect(getMaxRetries?.()).toBe(5);
        expect(getTimeout?.()).toBe(5000);
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
  });
});
