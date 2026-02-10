import { jest } from "@jest/globals";
import { createApifyMock } from "./apify-mock.js";
import { assertType } from "./test-utils.js";

import {
  HTTP_STATUS,
  MIME_TYPES,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_LOOP_SUFFIX,
  SENSITIVE_HEADERS,
  REPLAY_HEADERS_TO_IGNORE as REPLAY_HEADERS_TO_IGNORE_REAL,
  FORWARD_HEADERS_TO_IGNORE,
} from "../../../src/consts/http.js";

import {
  KVS_STATE_KEY,
  KVS_INPUT_KEY,
  MAX_DATASET_ITEM_BYTES,
  OFFLOAD_MARKER_SYNC as OFFLOAD_MARKER_SYNC_REAL,
  OFFLOAD_MARKER_STREAM as OFFLOAD_MARKER_STREAM_REAL,
  DEFAULT_OFFLOAD_NOTE,
} from "../../../src/consts/storage.js";

import {
  DEFAULT_ID_LENGTH,
  WEBHOOK_ID_PREFIX,
  REQUEST_ID_PREFIX,
  SYNC_ENTITY_SYSTEM,
  EVENT_NAMES,
  ERROR_LABELS,
  REPLAY_STATUS_LABELS,
  APIFY_HOMEPAGE_URL,
  EVENT_MAX_LISTENERS,
  DEFAULT_FIXED_MEMORY_MBYTES,
  MAX_SAFE_REPLAY_RETRIES,
  MAX_SAFE_RATE_LIMIT_PER_MINUTE,
  MAX_SAFE_RETENTION_HOURS,
  MAX_SAFE_URL_COUNT,
  MAX_SAFE_REPLAY_TIMEOUT_MS,
  MAX_SAFE_RESPONSE_DELAY_MS,
  MAX_ALLOWED_PAYLOAD_SIZE,
  MAX_SAFE_FORWARD_RETRIES,
  MAX_SAFE_FIXED_MEMORY_MBYTES,
} from "../../../src/consts/app.js";

import {
  SSRF_BLOCKED_RANGES,
  ALLOWED_PROTOCOLS,
  SSRF_INTERNAL_ERRORS,
  SSRF_LOG_MESSAGES,
  TRANSIENT_ERROR_CODES,
  DELIMITERS,
  PROTOCOL_PREFIXES,
} from "../../../src/consts/network.js";

import { SSRF_ERRORS } from "../../../src/consts/security.js";
import { ERROR_MESSAGES } from "../../../src/consts/errors.js";

import {
  DUCKDB_STORAGE_DIR_DEFAULT,
  DUCKDB_FILENAME_DEFAULT,
  DUCKDB_MEMORY_LIMIT,
  DUCKDB_THREADS,
  DUCKDB_POOL_SIZE,
  SQL_FRAGMENTS,
  SORT_DIRECTIONS,
  DB_MISSING_OFFSET_MARKER,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
} from "../../../src/consts/database.js";

import {
  DASHBOARD_PLACEHOLDERS,
  DASHBOARD_TEMPLATE_PATH,
  UNAUTHORIZED_HTML_TEMPLATE,
} from "../../../src/consts/ui.js";

/**
 * @typedef {import("apify").Dataset} Dataset
 * @typedef {import("apify").DatasetDataOptions} DatasetDataOptions
 * @typedef {import("express").Application} Application
 * @typedef {import("@duckdb/node-api").DuckDBInstance} DuckDBInstance
 * @typedef {import("@duckdb/node-api").DuckDBValue} DuckDBValue
 * @typedef {import("vm").Script} VMScript
 * @typedef {jest.MockedFunction<any> & { get: jest.Mock; post: jest.Mock; delete: jest.Mock; put: jest.Mock }} AxiosMock
 * @typedef {import("./apify-mock.js").KeyValueStoreMock} KeyValueStoreMock
 * @typedef {import("./apify-mock.js").ApifyMock} ApifyMock
 * @typedef {import("../../../src/logger_middleware.js").LoggerMiddleware} LoggerMiddleware
 * @typedef {import("../../../src/utils/app_state.js").AppState} AppState
 * @typedef {import("../../../src/utils/hot_reload_manager.js").HotReloadManager} HotReloadManager
 * @typedef {import("../../../src/typedefs.js").SignatureProvider} SignatureProvider
 * @typedef {import("../../../src/utils/webhook_rate_limiter.js").WebhookRateLimiter} WebhookRateLimiter
 * @typedef {import("../../../src/repositories/LogRepository.js").LogRepository} LogRepository
 * @typedef {import('../../../src/consts.js')} ConstsMock
 * @typedef {import('../../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../../src/utils/signature.js').VerificationResult} VerificationResult
 * @typedef {import('../../../src/utils/signature.js').VerificationContext} VerificationContext
 * @typedef {import('../../../src/services/SyncService.js').SyncService} SyncService
 
 */

/**
 * Shared logger mock for test assertions.
 * Import this in tests to verify logging behavior.
 *
 * @example
 * import { loggerMock } from "../setup/helpers/shared-mocks.js";
 * expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ component: "Main" }), "Failed");
 */
export const loggerMock = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(function () {
    return loggerMock;
  }),
};

/**
 * Standard axios mock for mirroring internal behavior.
 */
const axiosBase = /** @type {AxiosMock} */ (jest.fn());

axiosBase.mockResolvedValue({ status: HTTP_STATUS.OK, data: "OK" });
axiosBase.post = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: HTTP_STATUS.OK,
  data: "OK",
});
axiosBase.get = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: HTTP_STATUS.OK,
  data: "OK",
});
axiosBase.delete = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: HTTP_STATUS.OK,
  data: "OK",
});
axiosBase.put = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: HTTP_STATUS.OK,
  data: "OK",
});

export const axiosMock = axiosBase;

/**
 * Minimal Apify Actor mock for basic tests.
 */
export const apifyMock = Object.assign(createApifyMock(), {
  getValue: jest.fn(),
});

/**
 * DNS promises mock for SSRF testing.
 * Resolves to safe external IPs by default.
 */

export const dnsPromisesMock = {
  resolve4: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue([
    "93.184.216.34",
  ]),
  resolve6: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue([]),
};

/**
 * SSRF Utils Mock with proper type signatures.
 */
export const ssrfMock = {
  validateUrlForSsrf: /** @type {jest.Mock<any>} */ (
    jest.fn()
  ).mockResolvedValue({
    safe: true,
    href: "http://example.com",
    host: "example.com",
  }),
  SSRF_ERRORS,
  checkIpInRanges: /** @type {jest.Mock<any>} */ (jest.fn()).mockReturnValue(
    false,
  ),
};

/**
 * Creates a mock dataset with predefined items and realistic getData behavior.
 * Supports offset, limit, and fields projection.
 *
 * @example
 * // Basic usage:
 * const mockDataset = createDatasetMock([{ id: 1 }, { id: 2 }]);
 *
 * @example
 * // With autoRegister - automatically sets up apifyMock.openDataset:
 * const mockDataset = createDatasetMock(items, { autoRegister: true });
 * // Now apifyMock.openDataset() will return this dataset
 *
 * @param {Array<any>} [items=[]] - Initial dataset items
 * @param {Object} [options={}]
 * @param {boolean} [options.autoRegister=false] - Automatically register with apifyMock.openDataset
 * @returns {Dataset}
 */
export const createDatasetMock = (items = [], options = {}) => {
  const { autoRegister = false } = options;

  const dataset = /** @type {Dataset} */ ({
    getData: /** @type {Dataset['getData']} */ (
      /** @type {jest.Mock<any>} */ (jest.fn()).mockImplementation(
        /** @param {DatasetDataOptions} options */
        async ({ offset = 0, limit = 100, fields } = {}) => {
          // Simulate field projection if requested
          let result = items.slice(offset, offset + limit);

          if (fields && Array.isArray(fields)) {
            result = result.map((item) => {
              /** @type {Record<string, unknown>} */
              const projected = {};
              fields.forEach((f) => {
                if (item[f] !== undefined) projected[f] = item[f];
              });
              return projected;
            });
          }

          return {
            items: result,
            total: items.length,
            count: result.length,
            offset,
            limit,
          };
        },
      )
    ),
    pushData: /** @type {Dataset['pushData']} */ (
      /** @type {jest.Mock<any>} */ (jest.fn()).mockImplementation(
        /** @param {any} data */
        async (data) => {
          if (Array.isArray(data)) {
            items.push(...data);
          } else if (data) {
            items.push(data);
          }
        },
      )
    ),
    getInfo: /** @type {Dataset['getInfo']} */ (
      /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue({
        itemCount: items.length,
      })
    ),
  });

  // Auto-register with apifyMock.openDataset if requested
  if (autoRegister) {
    /** @type {jest.Mock<any>} */ (apifyMock.openDataset).mockResolvedValue(
      dataset,
    );
  }

  return dataset;
};

/**
 * Creates a mock KeyValueStore.
 * @param {Partial<KeyValueStoreMock>} [overrides={}] - Additional mock methods to override
 * @returns {KeyValueStoreMock}
 */
export const createKeyValueStoreMock = (overrides = {}) => ({
  getValue: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(null),
  setValue: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
    undefined,
  ),
  getPublicUrl: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
    "https://api.apify.com/v2/key-value-stores/default/records/payload_123",
  ),
  ...overrides,
});

/**
 * Setup basic Apify mock with standard lifecycle methods and defaults.
 * @param {ApifyMock} mockInstance
 * @param {Object} [options]
 * @param {Object} [options.input] - Default input to return
 * @param {boolean} [options.isAtHome] - Return value for isAtHome
 * @param {KeyValueStoreMock} [options.kvStore] - Custom KV store mock
 * @param {Array<any>} [options.datasetItems] - Initial items for default dataset
 */
export const setupBasicApifyMock = (mockInstance, options = {}) => {
  const {
    input = {},
    isAtHome = false,
    kvStore = createKeyValueStoreMock(),
    datasetItems = [],
  } = options;

  mockInstance.init.mockResolvedValue(undefined);
  mockInstance.getInput.mockResolvedValue(input);
  mockInstance.isAtHome.mockReturnValue(isAtHome);
  mockInstance.pushData.mockResolvedValue(undefined);
  mockInstance.openKeyValueStore.mockResolvedValue(kvStore);

  const dataset = createDatasetMock(datasetItems);
  /** @type {jest.Mock<any>} */ (mockInstance.openDataset).mockResolvedValue(
    dataset,
  );

  return { kvStore, dataset };
};

/**
 * Resets network mocks (SSRF, DNS, Axios) to their default safe states.
 * Useful for beforeEach blocks.
 */
export const resetNetworkMocks = async () => {
  // Reset SSRF
  ssrfMock.validateUrlForSsrf.mockResolvedValue({
    safe: true,
    href: "http://example.com",
    host: "example.com",
  });
  ssrfMock.checkIpInRanges.mockReturnValue(false);

  // Reset DNS
  dnsPromisesMock.resolve4.mockResolvedValue(["93.184.216.34"]);
  dnsPromisesMock.resolve6.mockResolvedValue([]);

  // Reset Axios
  axiosMock.mockResolvedValue({ status: HTTP_STATUS.OK, data: "OK" });
  axiosMock.post.mockResolvedValue({ status: HTTP_STATUS.OK, data: "OK" });
  axiosMock.get.mockResolvedValue({ status: HTTP_STATUS.OK, data: "OK" });
};

/**
 * @type {WebhookManager}
 */

/**
 * Creates a mock WebhookManager with sensible defaults.
 *
 * This eliminates the need to manually create WebhookManager mocks
 * in every middleware test. Only includes methods that actually exist
 * in the real WebhookManager class.
 *
 * @example
 * const webhookManager = createMockWebhookManager();
 *
 * @example
 * const webhookManager = createMockWebhookManager({
 *   isValid: false,
 *   webhookData: { expiresAt: '2026-01-01T00:00:00Z' }
 * });
 *
 * @param {Object} [overrides={}]
 * @param {boolean} [overrides.isValid=true] - Return value for isValid()
 * @param {object} [overrides.webhookData={}] - Return value for getWebhookData()
 * @returns {WebhookManager}
 */
export function createMockWebhookManager(overrides = {}) {
  return /** @type {any} */ ({
    // Core methods actually used in tests
    isValid: /** @type {jest.Mock<any>} */ (jest.fn()).mockReturnValue(
      overrides.isValid ?? true,
    ),
    getWebhookData: /** @type {jest.Mock<any>} */ (jest.fn()).mockReturnValue(
      overrides.webhookData ?? {},
    ),

    // Lifecycle methods
    init: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
      undefined,
    ),
    persist: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
      undefined,
    ),
    cleanup: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
      undefined,
    ),

    // Webhook management
    generateWebhooks: /** @type {jest.Mock<any>} */ (
      jest.fn()
    ).mockResolvedValue([]),
    getAllActive: /** @type {jest.Mock<any>} */ (jest.fn()).mockReturnValue([]),
    updateRetention: /** @type {jest.Mock<any>} */ (
      jest.fn()
    ).mockResolvedValue(undefined),

    // State
    webhooks: new Map(),
    kvStore: null,
    STATE_KEY: KVS_STATE_KEY,
  });
}

/**
 * Shared Express App Mock.
 * Simulates an Express application with common methods.
 */
/**
 * @type {jest.Mocked<Application>}
 */
export const expressAppMock = assertType({
  use: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
  set: jest.fn(),
  listen: jest.fn((_port, cb) => {
    if (typeof cb === "function") cb();
    return {
      close: jest.fn((closeCb) => {
        if (typeof closeCb === "function") closeCb();
      }),
      listening: true,
    };
  }),
});

/**
 * Shared Express Mock (default export).
 * Includes static methods like express.static.
 */
/**
 * @type {jest.Mock}
 */
export const expressMock = Object.assign(
  jest.fn(() => expressAppMock),
  {
    static: jest.fn(),
  },
);

/**
 * Shared DuckDB Mock.
 */
/**
 * @type {jest.Mocked<{getDbInstance: jest.Mock<() => Promise<DuckDBInstance>>, executeQuery: jest.Mock<(query: string, params?: Record<string, any>) => Promise<(Record<string, DuckDBValue>)[]>>, executeWrite: jest.Mock<(query: string, params?: Record<string, any>) => Promise<void>>, executeTransaction: jest.Mock<(cb: (conn: {run: jest.Mock<any>}) => void) => void>, vacuumDb: jest.Mock<() => Promise<void>>}>}
 */
export const duckDbMock = {
  getDbInstance: assertType(jest.fn()).mockResolvedValue({}),
  executeQuery: assertType(jest.fn().mockResolvedValue(assertType([]))),
  executeWrite: assertType(jest.fn().mockResolvedValue(assertType(undefined))),
  executeTransaction: assertType(
    jest.fn(
      /**
       * @param {(conn: {run: jest.Mock<any>}) => void} cb
       */
      (cb) => cb({ run: jest.fn() }),
    ),
  ),
  vacuumDb: assertType(jest.fn()).mockResolvedValue(undefined),
};

/**
 * Shared SyncService Mock.
 */
/**
 * @type {jest.Mocked<SyncService>}
 */
export const syncServiceMock = assertType({
  start: jest.fn(),
  stop: jest.fn(),
  getMetrics: jest.fn(),
});

/**
 * Shared WebhookManager Mock.
 */
/**
 * @type {WebhookManager}
 */
export const webhookManagerMock = createMockWebhookManager();

/**
 * Shared LoggerMiddleware Mock.
 */
/**
 * @type {jest.Mocked<LoggerMiddleware>}
 */
export const loggerMiddlewareMock = assertType({
  middleware: jest.fn(),
  ingestMiddleware: jest.fn(),
  updateOptions: jest.fn(),
  options: {},
});

/**
 * Shared AppState Mock.
 */
/**
 * @type {jest.Mocked<AppState>}
 */
export const appStateMock = assertType({
  destroy: jest.fn(),
  applyConfigUpdate: jest.fn(),
  rateLimitMiddleware: jest.fn(),
  bodyParserMiddleware: jest.fn(),
});

/**
 * Shared HotReloadManager Mock.
 */
/**
 * @type {jest.Mocked<HotReloadManager>}
 */
export const hotReloadManagerMock = assertType({
  init: jest.fn().mockResolvedValue(assertType(undefined)),
  start: jest.fn(),
  stop: jest.fn().mockResolvedValue(assertType(undefined)),
});

/**
 * Shared Bootstrap Mock.
 */
/**
 * @type {jest.Mocked<{ensureLocalInputExists: jest.Mock}>}
 */
export const bootstrapMock = assertType({
  ensureLocalInputExists: jest.fn().mockResolvedValue(assertType(undefined)),
});

/**
 * Shared Routes Mock.
 */
/**
 * @type {jest.Mocked<{createBroadcaster: jest.Mock, createLogsHandler: jest.Mock, createLogDetailHandler: jest.Mock, createLogPayloadHandler: jest.Mock, createInfoHandler: jest.Mock, createLogStreamHandler: jest.Mock, createReplayHandler: jest.Mock, createDashboardHandler: jest.Mock, createSystemMetricsHandler: jest.Mock, createHealthRoutes: jest.Mock}>}
 */
export const routesMock = assertType({
  createBroadcaster: jest.fn(() => jest.fn()),
  createLogsHandler: jest.fn(() => jest.fn()),
  createLogDetailHandler: jest.fn(() => jest.fn()),
  createLogPayloadHandler: jest.fn(() => jest.fn()),
  createInfoHandler: jest.fn(() => jest.fn()),
  createLogStreamHandler: jest.fn(() => jest.fn()),
  createReplayHandler: jest.fn(() => jest.fn()),
  createDashboardHandler: jest.fn(() => jest.fn()),
  createSystemMetricsHandler: jest.fn(() => jest.fn()),
  createHealthRoutes: jest.fn(() => ({ health: jest.fn(), ready: jest.fn() })),
  preloadTemplate: jest.fn().mockResolvedValue(assertType("index")),
});

/**
 * Shared MiddlewareFactories Mock.
 */
/**
 * @type {jest.Mocked<{createAuthMiddleware: jest.Mock, createJsonParserMiddleware: jest.Mock, createRequestIdMiddleware: jest.Mock, createCspMiddleware: jest.Mock, createErrorHandler: jest.Mock}>}
 */
export const middlewareFactoriesMock = assertType({
  createAuthMiddleware: jest.fn(() => jest.fn()),
  createJsonParserMiddleware: jest.fn(() => jest.fn()),
  createRequestIdMiddleware: jest.fn(() => jest.fn()),
  createCspMiddleware: jest.fn(() => jest.fn()),
  createErrorHandler: jest.fn(() => jest.fn()),
});

// Keep a mutable base object for test-overridable constants
/** @type {Record<string, any>} */
const overridableConsts = {
  BACKGROUND_TASK_TIMEOUT_PROD_MS: 1000,
  BACKGROUND_TASK_TIMEOUT_TEST_MS: 100,
  RETENTION_LOG_SUPPRESSION_MS: 100,
  DNS_RESOLUTION_TIMEOUT_MS: 100,
  INPUT_POLL_INTERVAL_PROD_MS: 100,
  INPUT_POLL_INTERVAL_TEST_MS: 100,
  REPLAY_SCAN_MAX_DEPTH_MS: 3600000,
  HOT_RELOAD_DEBOUNCE_MS: 10,
  HOT_RELOAD_ENABLED: true,
  DEFAULT_URL_COUNT: 1,
  DEFAULT_RETENTION_HOURS: 24,
  DEFAULT_RATE_LIMIT_PER_MINUTE: 60,
  DEFAULT_RATE_LIMIT_MAX_ENTRIES: 100,
  DEFAULT_WEBHOOK_RATE_LIMIT_PER_MINUTE: 100,
  DEFAULT_WEBHOOK_RATE_LIMIT_MAX_ENTRIES: 100,
  DEFAULT_RATE_LIMIT_WINDOW_MS: 60000,
  DEFAULT_PAYLOAD_LIMIT: 1000,
  DEFAULT_TOLERANCE_SECONDS: 300,
  DEFAULT_REPLAY_RETRIES: 3,
  DEFAULT_REPLAY_TIMEOUT_MS: 1000,
  DEFAULT_FORWARD_RETRIES: 3,
  FORWARD_TIMEOUT_MS: 1000,
  RETRY_BASE_DELAY_MS: 100,
  SCRIPT_EXECUTION_TIMEOUT_MS: 1000,
  MAX_SSE_CLIENTS: 2,
  MAX_BULK_CREATE: 10,
  MAX_ITEMS_FOR_BATCH: 100,
  SYNC_MAX_CONCURRENT: 1,
  SYNC_MIN_TIME_MS: 0,
  SYNC_BATCH_SIZE: 10,
  SSE_HEARTBEAT_INTERVAL_MS: 100,
  SHUTDOWN_TIMEOUT_MS: 100,
  STARTUP_TEST_EXIT_DELAY_MS: 100,
  CLEANUP_INTERVAL_MS: 100,
  DUCKDB_POOL_SIZE: 2,
  // Primitives that tests explicitly override:
  DUCKDB_VACUUM_ENABLED: false,
  DUCKDB_VACUUM_INTERVAL_MS: 24 * 60 * 60 * 1000,
};

/**
 * Shared Consts Mock.
 * Uses getters for overridable values to support ESM live binding updates in tests.
 */
/** @type {Record<string, any>} */
export const constsMock = {
  HTTP_STATUS,
  MIME_TYPES,
  ERROR_LABELS,
  REPLAY_STATUS_LABELS,
  RECURSION_HEADER_LOOP_SUFFIX,
  SENSITIVE_HEADERS,
  REPLAY_HEADERS_TO_IGNORE: [
    ...REPLAY_HEADERS_TO_IGNORE_REAL,
    "ignored-header",
  ],
  FORWARD_HEADERS_TO_IGNORE,
  ALLOWED_PROTOCOLS,
  PROTOCOL_PREFIXES,
  SSRF_BLOCKED_RANGES,
  SSRF_ERRORS,
  SSRF_INTERNAL_ERRORS,
  SSRF_LOG_MESSAGES,
  ERROR_MESSAGES,
  DELIMITERS,
  SQL_FRAGMENTS,
  SORT_DIRECTIONS,
  EVENT_NAMES,
  DEFAULT_ID_LENGTH,
  WEBHOOK_ID_PREFIX,
  REQUEST_ID_PREFIX,
  SYNC_ENTITY_SYSTEM,
  DB_MISSING_OFFSET_MARKER,
  DEFAULT_FIXED_MEMORY_MBYTES,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE: "Apify-Webhook-Debugger",
  APIFY_HOMEPAGE_URL,
  EVENT_MAX_LISTENERS,
  TRANSIENT_ERROR_CODES,
  KVS_STATE_KEY,
  KVS_INPUT_KEY,
  MAX_DATASET_ITEM_BYTES,
  KVS_OFFLOAD_THRESHOLD: 1024 * 1024,
  OFFLOAD_MARKER_SYNC: OFFLOAD_MARKER_SYNC_REAL,
  OFFLOAD_MARKER_STREAM: OFFLOAD_MARKER_STREAM_REAL,
  DEFAULT_OFFLOAD_NOTE,
  MAX_SAFE_REPLAY_RETRIES,
  MAX_SAFE_RATE_LIMIT_PER_MINUTE,
  MAX_SAFE_RETENTION_HOURS,
  MAX_SAFE_URL_COUNT,
  MAX_SAFE_REPLAY_TIMEOUT_MS,
  MAX_SAFE_RESPONSE_DELAY_MS,
  MAX_ALLOWED_PAYLOAD_SIZE,
  MAX_SAFE_FORWARD_RETRIES,
  MAX_SAFE_FIXED_MEMORY_MBYTES,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
  DUCKDB_STORAGE_DIR_DEFAULT,
  DUCKDB_FILENAME_DEFAULT,
  DUCKDB_MEMORY_LIMIT,
  DUCKDB_THREADS,
  DUCKDB_POOL_SIZE,
  DASHBOARD_PLACEHOLDERS,
  DASHBOARD_TEMPLATE_PATH,
  UNAUTHORIZED_HTML_TEMPLATE,
};

// Dynamically add getters for overridable constants
for (const key of Object.keys(overridableConsts)) {
  Object.defineProperty(constsMock, key, {
    get: () => overridableConsts[key],
    set: (val) => {
      overridableConsts[key] = val;
    },
    enumerable: true,
    configurable: true,
  });
}

/**
 * Shared Auth Mock.
 */
/**
 * @type {jest.Mocked<{validateAuth: (req: any, key: string) => {isValid: boolean, error?: string}}>}
 */
export const authMock = {
  validateAuth: jest.fn((_req, key) => {
    if (key === "invalid-key") return { isValid: false, error: "Unauthorized" };
    return { isValid: true };
  }),
};

/**
 * Shared Signature Mock.
 */
/**
 * @type {jest.Mocked<{verifySignature: (data: any, signature: string) => {valid: boolean, provider: SignatureProvider}, createStreamVerifier: (stream: any) => VerificationResult, finalizeStreamVerification: (stream: any) => boolean}>}}
 */
export const signatureMock = {
  verifySignature: jest.fn(() => ({ valid: true, provider: "github" })),
  createStreamVerifier: jest.fn(() =>
    assertType({ hmac: { update: jest.fn() } }),
  ),
  finalizeStreamVerification: jest.fn(() => true),
};

/**
 * Shared Webhook Rate Limiter Mock.
 */
/**
 * @type {jest.Mocked<{webhookRateLimiter: WebhookRateLimiter}>}
 */
export const webhookRateLimiterMock = {
  webhookRateLimiter: assertType({
    check: jest.fn(() => ({ allowed: true, remaining: 100, resetMs: 0 })),
    limit: 100,
  }),
};

/**
 * Shared Storage Helper Mock.
 */
/**
 * @type {jest.Mocked<{generateKvsKey: () => string, offloadToKvs: (key: string, value: any, contentType: string) => Promise<void>, getKvsUrl: (key: string) => Promise<string>, createReferenceBody: (opts: any) => any, OFFLOAD_MARKER_STREAM: string, OFFLOAD_MARKER_SYNC: string}>}}
 */
export const storageHelperMock = {
  generateKvsKey: jest.fn(() => "mock-kvs-key"),
  offloadToKvs: assertType(jest.fn()).mockResolvedValue(undefined),
  getKvsUrl: assertType(jest.fn()).mockResolvedValue(
    assertType("http://mock-kvs-url"),
  ),
  createReferenceBody: jest.fn((opts) =>
    assertType({ ...assertType(opts), isReference: true }),
  ),
  OFFLOAD_MARKER_STREAM: OFFLOAD_MARKER_STREAM_REAL,
  OFFLOAD_MARKER_SYNC: OFFLOAD_MARKER_SYNC_REAL,
};

/**
 * Shared Config Mock.
 */
/**
 * @type {jest.Mocked<{getSafeResponseDelay: (opts: any) => any, parseWebhookOptions: (opts: any) => any, normalizeInput: (i: any) => any, coerceRuntimeOptions: (o: any) => any}>}
 */
export const configMock = {
  getSafeResponseDelay: jest.fn(() => 0),
  parseWebhookOptions: jest.fn((opts) => ({
    allowedIps: [],
    defaultResponseCode: HTTP_STATUS.OK,
    defaultResponseBody: "OK",
    defaultResponseHeaders: {},
    maskSensitiveData: true,
    enableJSONParsing: true,
    ...(opts || {}),
  })),
  normalizeInput: jest.fn((i) => i),
  coerceRuntimeOptions: jest.fn((o) => o),
};

/**
 * Shared Alerting Mock.
 */
/**
 * @type {jest.Mocked<{triggerAlertIfNeeded: (opts: any) => boolean}>}
 */
export const alertingMock = {
  triggerAlertIfNeeded: jest.fn(),
};

/**
 * Shared Events Mock.
 */
/**
 * @type {jest.Mocked<{appEvents: {emit: (event: string, data: any) => void, on: (event: string, listener: (data: any) => void) => void, off: (event: string, listener: (data: any) => void) => void}, EVENTS: {LOG_RECEIVED: string}}>}}
 */
export const eventsMock = {
  appEvents: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
  EVENTS: {
    LOG_RECEIVED: EVENT_NAMES.LOG_RECEIVED,
  },
};

/**
 * Shared VM Mock (for custom scripts).
 */
export const mockScriptRun = jest.fn();
/**
 * @type {jest.Mocked<{default: {Script: VMScript}}>}
 */
export const vmMock = {
  default: {
    Script: assertType(
      jest.fn((code) => {
        if (code === "throw") throw new Error("Syntax Error");
        return {
          runInNewContext: mockScriptRun,
        };
      }),
    ),
  },
};

/**
 * Shared LogRepository Mock.
 */
/**
 * @type {jest.Mocked<LogRepository>}
 */
export const logRepositoryMock = assertType({
  insertLog: jest.fn(),
  batchInsertLogs: jest.fn(),
  getLogById: jest.fn(),
  findLogs: jest.fn(),
  findLogsCursor: jest.fn(),
  findOffloadedPayloads: jest.fn(),
  deleteLogsByWebhookId: jest.fn(),
});

/**
 * Shared FS Promises Mock.
 */
export const fsPromisesMock = {
  access: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
  mkdir: jest.fn(),
  rm: jest.fn(),
  unlink: jest.fn(),
  watch: jest.fn(),
};

/**
 * Shared FS Mock.
 */
export const fsMock = {
  existsSync: jest.fn(),
  ...fsPromisesMock,
};
