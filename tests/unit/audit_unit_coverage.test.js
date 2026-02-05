import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import path from "node:path";
import { HTTP_STATUS, MIME_TYPES } from "../../src/consts.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  apifyMock,
  ssrfMock,
  webhookManagerMock,
} from "../setup/helpers/shared-mocks.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
  sleep,
} from "../setup/helpers/test-utils.js";

/**
 * @typedef {typeof import("@duckdb/node-api")} DuckDBNodeApi
 * @typedef {import("@duckdb/node-api").DuckDBInstance} DuckDBInstance
 * @typedef {typeof import("../../src/db/duckdb.js")} DuckDB
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 */

// 1. Mock dependencies that aren't in shared-mocks or need specific low-level behavior
/** @type {jest.Mocked<DuckDBNodeApi>} */
const mockDuckDBNodeApi = assertType({
  /** @type {jest.Mocked<DuckDBInstance>} */
  DuckDBInstance: assertType({
    fromCache: assertType(jest.fn()).mockResolvedValue({
      connect: assertType(jest.fn()).mockResolvedValue({
        run: jest.fn(),
        closeSync: jest.fn(),
      }),
    }),
  }),
});

jest.unstable_mockModule("@duckdb/node-api", () => mockDuckDBNodeApi);

// Setup common mocks
await setupCommonMocks({
  logger: true,
  apify: true,
  consts: true,
  fs: true,
});

describe("Audit Unit Coverage", () => {
  describe("DuckDB Dynamic Paths", () => {
    /** @type {DuckDB} */
    let DuckDB;
    const originalEnv = process.env;

    beforeEach(async () => {
      process.env = { ...originalEnv };
      jest.resetModules();
      DuckDB = await import("../../src/db/duckdb.js");
      await DuckDB.resetDbInstance();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test("getDbPath should reflect environment changes", async () => {
      process.env.DUCKDB_STORAGE_DIR = "/custom/path";
      process.env.DUCKDB_FILENAME = "custom.db";

      await DuckDB.getDbInstance();

      expect(mockDuckDBNodeApi.DuckDBInstance.fromCache).toHaveBeenCalledWith(
        path.join("/custom/path", "custom.db"),
      );
    });

    test("resetDbInstance should clear singleton and allow re-init with new path", async () => {
      process.env.DUCKDB_FILENAME = "first.db";
      await DuckDB.getDbInstance();
      expect(mockDuckDBNodeApi.DuckDBInstance.fromCache).toHaveBeenCalledWith(
        expect.stringContaining("first.db"),
      );

      await DuckDB.resetDbInstance();

      process.env.DUCKDB_FILENAME = "second.db";
      await DuckDB.getDbInstance();
      expect(mockDuckDBNodeApi.DuckDBInstance.fromCache).toHaveBeenCalledWith(
        expect.stringContaining("second.db"),
      );
    });
  });

  describe("LoggerMiddleware Overrides", () => {
    /** @type {typeof import("../../src/logger_middleware.js").LoggerMiddleware} */
    let LoggerMiddleware;

    beforeEach(async () => {
      const mod = await import("../../src/logger_middleware.js");
      LoggerMiddleware = mod.LoggerMiddleware;
    });

    test("should include forwarding fields in allowed overrides", async () => {
      const mockForwardingService = {
        forwardWebhook: assertType(jest.fn()).mockResolvedValue(undefined),
      };

      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        {},
        () => {},
        mockForwardingService,
      );

      jest.mocked(webhookManagerMock.getWebhookData).mockReturnValue(
        assertType({
          forwardUrl: "http://override.com",
          forwardHeaders: false,
        }),
      );

      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);

      // Mock SSRF validation as it is called during ingestion if forwarding is active
      jest.mocked(ssrfMock.validateUrlForSsrf).mockResolvedValue({
        safe: true,
        href: "http://override.com",
        host: "override.com",
      });

      const req = createMockRequest({
        params: { id: "wh_1" },
        method: "POST",
        headers: { "content-type": MIME_TYPES.JSON },
        body: { test: true },
      });
      const res = createMockResponse();
      const next = createMockNextFunction();

      // Execute
      await middleware.middleware(req, res, next);

      // Background tasks are async, wait for them to finish (they are raced with 100ms timeout in test)
      await sleep(HTTP_STATUS.OK);

      expect(mockForwardingService.forwardWebhook).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          forwardUrl: "http://override.com",
          forwardHeaders: false,
        }),
        "http://override.com",
      );
    });
  });

  describe("Graceful Exit Logic (main.js)", () => {
    test("should bypass Actor.exit and process.exit when NODE_ENV=test", async () => {
      // We verify the logic by checking if we can import main.js
      // without it triggering an immediate exit in the test runner.
      // Since we've wrapped the calls in 'if (process.env.NODE_ENV !== "test")',
      // this test process remains alive.

      expect(process.env.NODE_ENV).toBe("test");

      // Re-importing main.js triggers the handler registration logic,
      // but not the exit logic until a signal is received.
      const { shutdown } = await import(`../../src/main.js?t=${Date.now()}`);

      // Trigger shutdown manually
      await shutdown("TEST_SIGNAL");

      // Verify Actor.exit was NOT called because we are in test mode
      expect(apifyMock.exit).not.toHaveBeenCalled();
    });
  });

  describe("Decompression Bomb (Zip Bomb) Protection", () => {
    /** @type {typeof import("../../src/utils/app_state.js")} */
    let AppStateMod;

    /** @type {typeof import("node:zlib")} */
    let zlib;

    beforeEach(async () => {
      AppStateMod = await import("../../src/utils/app_state.js");
      zlib = await import("node:zlib");
    });

    test("should reject inflated payload exceeding limit (Zip Bomb resilience)", async () => {
      // Create a small compressed payload that expands to > 1KB
      // We use '0' repeating 10000 times.
      const largeData = Buffer.alloc(10000, "0");
      const compressed = zlib.gzipSync(largeData);

      // Limit is 1KB (1024 bytes). Compressed size is much smaller (~30 bytes).
      const maxPayloadSize = 1024;

      // Setup AppState with 1KB limit
      const appState = new AppStateMod.AppState(
        { maxPayloadSize },
        webhookManagerMock,
        assertType({}),
      );
      const bodyParser = appState.bodyParserMiddleware;

      const req = createMockRequest({
        headers: {
          "content-encoding": "gzip",
          "content-type": "application/json",
          "content-length": compressed.length.toString(),
        },
      });

      // Simulate stream
      const { Readable } = await import("node:stream");
      const stream = Readable.from(compressed);

      // We need to carefully pipe the stream through the mock request
      // body-parser expects a request stream.
      // We'll decorate our mock req with stream methods.
      Object.setPrototypeOf(req, Readable.prototype);
      Object.assign(req, stream);

      const res = createMockResponse();

      // Execute body-parser
      await new Promise((resolve) => {
        bodyParser(
          req,
          res,
          createMockNextFunction(
            assertType(jest.fn()).mockImplementation(
              /**
               * @param {CommonError} err
               */
              (err) => {
                if (err) {
                  res.status(err.status || 500).json({ error: err.message });
                }
                resolve(undefined);
              },
            ),
          ),
        );
      });

      // Verify HTTP_STATUS.PAYLOAD_TOO_LARGE Payload Too Large
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.PAYLOAD_TOO_LARGE);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringMatching(/too large/i),
        }),
      );
    });
  });
});
