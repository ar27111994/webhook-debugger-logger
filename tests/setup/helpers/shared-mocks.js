import { jest } from "@jest/globals";
import { createApifyMock } from "./apify-mock.js";
import { assertType } from "./test-utils.js";

import * as allConsts from "../../../src/consts/index.js";

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
 * @typedef {import('../../../src/consts/index.js')} ConstsMock
 * @typedef {import('../../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../../src/utils/signature.js').VerificationResult} VerificationResult
 * @typedef {import('../../../src/utils/signature.js').VerificationContext} VerificationContext
 * @typedef {import('../../../src/services/SyncService.js').SyncService} SyncService
 * @typedef {import("../../../src/services/ForwardingService.js").ForwardingService} ForwardingService
 * @typedef {import("../../../src/utils/crypto.js")} CryptoUtils
 * @typedef {import("../../../src/utils/ssrf.js")} SSRFUtils
 * @typedef {import("crypto")} Crypto
 * @typedef {import("fs")} FsWithPromises
 * @typedef {import("dns").promises} DnsPromises
 */

const SHARED_CONSTS = Object.freeze({
  // eslint-disable-next-line sonarjs/no-hardcoded-ip
  SAFE_IP: "93.184.216.34",
  DEFAULT_LIMIT: 100,
  DEFAULT_PAYLOAD_SIZE_BYTES:
    // eslint-disable-next-line no-magic-numbers
    10 * allConsts.APP_CONSTS.BYTES_PER_KB * allConsts.APP_CONSTS.BYTES_PER_KB, // 10MB
  // eslint-disable-next-line no-magic-numbers
  ONE_DAY_MS: allConsts.APP_CONSTS.MS_PER_HOUR * 24,
  FORWARDING_RESPONSE_DATA: "Forwarded OK",
});

/**
 * Creates an object with dynamic getters for all properties of the source object.
 * This allows mocks to reflect updates to the source object immediately.
 *
 * @param {Record<string, any>} target - The target object to modify or create
 * @param {Record<string, any>} source - The source object to proxy values from
 * @returns {Record<string, any>} The modified target object
 */
export function createMockWithGetters(target, source) {
  for (const key of Object.keys(source)) {
    Object.defineProperty(target, key, {
      get: () => source[key],
      set: (val) => {
        source[key] = val;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return target;
}

// Extracts for internal mock usage and backward compatibility
const {
  HTTP_STATUS,
  HTTP_STATUS_MESSAGES,
  STORAGE_CONSTS,
  KVS_KEYS,
  APP_CONSTS,
  WEBHOOK_ID_PREFIX,
  REQUEST_ID_PREFIX,
  SYSTEM_CONSTS,
  INTERNAL_EVENTS,
  REPLAY_STATUS_LABELS,
  EVENT_MAX_LISTENERS,
  APP_ROUTES,
  FORWARDING_CONSTS,
  SORT_DIRECTIONS,
  ENV_VARS,
  SSRF_ERRORS,
  DUCKDB_TABLES,
  DUCKDB_STORAGE_DIR_DEFAULT,
  DUCKDB_FILENAME_DEFAULT,
  DUCKDB_MEMORY_LIMIT,
  DUCKDB_THREADS,
  SQL_FRAGMENTS,
  DB_MISSING_OFFSET_MARKER,
  PAGINATION_CONSTS,
  ERROR_MESSAGES,
  LOG_MESSAGES,
  HTTP_HEADERS,
  MIME_TYPES,
} = allConsts;

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
 * Shared Pino Factory Mock.
 */
export const pinoMock = Object.assign(
  jest.fn(() => loggerMock),
  {
    stdTimeFunctions: { isoTime: jest.fn() },
    transport: jest.fn(),
  },
);

/**
 * Standard axios mock for mirroring internal behavior.
 */
/**
 * @type {AxiosMock}
 */
const axiosBase = (
  jest.fn().mockImplementation((config) => {
    return Promise.resolve({
      status: HTTP_STATUS.OK,
      data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
      headers: {},
      config: typeof config === "string" ? { url: config } : config,
    });
  })
);

/**
 * @type {jest.MockedFunction<AxiosMock>}
 */
axiosBase[allConsts.HTTP_METHODS.GET.toLowerCase()] = (
  jest
    .fn()
    .mockImplementation((url, config) =>
      axiosBase({ method: allConsts.HTTP_METHODS.GET, url, ...(config || {}) }),
    )
);

/**
 * @type {jest.MockedFunction<AxiosMock>}
 */
axiosBase[allConsts.HTTP_METHODS.POST.toLowerCase()] =
  (jest.fn().mockImplementation((url, data, config) =>
    axiosBase({
      method: allConsts.HTTP_METHODS.POST,
      url,
      data,
      ...(config || {}),
    }),
  )
  );

/**
 * @type {jest.MockedFunction<AxiosMock>}
 */
axiosBase[allConsts.HTTP_METHODS.PUT.toLowerCase()] = (jest.fn().mockImplementation((url, data, config) =>
  axiosBase({
    method: allConsts.HTTP_METHODS.PUT,
    url,
    data,
    ...(config || {}),
  }),
)
);

/**
 * @type {jest.MockedFunction<AxiosMock>}
 */
axiosBase[allConsts.HTTP_METHODS.DELETE.toLowerCase()] =
  (jest.fn().mockImplementation((url, config) =>
    axiosBase({
      method: allConsts.HTTP_METHODS.DELETE,
      url,
      ...(config || {}),
    }),
  )
  );

/**
 * @type {jest.MockedFunction<AxiosMock>}
 */
axiosBase.request = (jest.fn().mockImplementation((config) => axiosBase(config)));

/**
 * @type {jest.MockedFunction<AxiosMock>}
 */
axiosBase.create = jest.fn(() => axiosBase);

/**
 * @type {jest.MockedFunction<AxiosMock>}
 */
axiosBase.isCancel = jest.fn(() => false);

export const axiosMock = axiosBase;

/**
 * Minimal Apify Actor mock for basic tests.
 */
/**
 * @type {jest.Mocked<ApifyMock>}
 */
export const apifyMock = assertType(Object.assign(createApifyMock(), {
  getValue: jest.fn(),
}));

/**
 * DNS promises mock for SSRF testing.
 * Resolves to safe external IPs by default.
 */
/**
 * @type {jest.Mocked<DnsPromises>}
 */
export const dnsPromisesMock = assertType({
  resolve4: assertType(jest.fn()).mockResolvedValue([
    SHARED_CONSTS.SAFE_IP,
  ]),
  resolve6: assertType(jest.fn()).mockResolvedValue([]),
});

/**
 * SSRF Utils Mock with proper type signatures.
 */
/**
 * @type {jest.Mocked<SSRFUtils>}
 */
export const ssrfMock = assertType({
  validateUrlForSsrf: assertType(jest.fn()).mockResolvedValue({
    safe: true,
    href: "https://example.com",
    host: "example.com",
  }),
  SSRF_ERRORS,
  checkIpInRanges: (jest.fn()).mockReturnValue(
    false,
  ),
});

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
      async ({
        offset = 0,
        limit = SHARED_CONSTS.DEFAULT_LIMIT,
        fields,
      } = {}) => {
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
  dnsPromisesMock.resolve4.mockResolvedValue([SHARED_CONSTS.SAFE_IP]);
  dnsPromisesMock.resolve6.mockResolvedValue([]);

  // Reset Axios
  axiosMock.mockResolvedValue({
    status: HTTP_STATUS.OK,
    data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
  });
  axiosMock.post.mockResolvedValue({
    status: HTTP_STATUS.OK,
    data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
  });
  axiosMock.get.mockResolvedValue({
    status: HTTP_STATUS.OK,
    data: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
  });
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
  return assertType({
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
    STATE_KEY: KVS_KEYS.STATE,
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
  DEFAULT_PAYLOAD_LIMIT: SHARED_CONSTS.DEFAULT_PAYLOAD_SIZE_BYTES,
  DEFAULT_TOLERANCE_SECONDS: 300,
  DEFAULT_REPLAY_RETRIES: 3,
  DEFAULT_REPLAY_TIMEOUT_MS: 1000,
  DEFAULT_FORWARD_RETRIES: 3,
  FORWARD_TIMEOUT_MS: 1000,
  RETRY_BASE_DELAY_MS: 100,
  SCRIPT_EXECUTION_TIMEOUT_MS: 1000,
  MAX_SSE_CLIENTS: 2,
  MAX_BULK_CREATE: 1000,
  MAX_ITEMS_FOR_BATCH: 100,
  MAX_SAFE_RESPONSE_DELAY_MS: 10000,
  SYNC_MAX_CONCURRENT: 1,
  ALERT_CHANNELS: { SLACK: "slack", DISCORD: "discord" },
  ALERT_TRIGGERS: {
    ERROR: "error",
    STATUS_4XX: "4xx",
    STATUS_5XX: "5xx",
    TIMEOUT: "timeout",
    SIGNATURE_INVALID: "signature_invalid",
  },
  SLACK_BLOCK_TYPES: {
    HEADER: "header",
    SECTION: "section",
    CONTEXT: "context",
    PLAIN_TEXT: "plain_text",
    MARKDOWN: "mrkdwn",
  },
  DISCORD_COLORS: { RED: 0xff0000, ORANGE: 0xffa500, GREEN: 0x00ff00 },
  ALERT_TIMEOUT_MS: 5000,
  SYNC_MIN_TIME_MS: 0,
  SYNC_BATCH_SIZE: 10,
  SSE_HEARTBEAT_INTERVAL_MS: 100,
  SHUTDOWN_TIMEOUT_MS: 100,
  STARTUP_TEST_EXIT_DELAY_MS: 100,
  CLEANUP_INTERVAL_MS: 100,
  DUCKDB_POOL_SIZE: 2,
  // Primitives that tests explicitly override:
  DUCKDB_VACUUM_ENABLED: false,
  DUCKDB_VACUUM_INTERVAL_MS: SHARED_CONSTS.ONE_DAY_MS,
};

/**
 * Shared Consts Mock.
 * Uses getters for overridable values to support ESM live binding updates in tests.
 */
/** @type {Record<string, any>} */
export const constsMock = {
  ...allConsts,
  // Custom test-only adjustments
  REPLAY_HEADERS_TO_IGNORE: [
    ...(allConsts.REPLAY_HEADERS_TO_IGNORE || []),
    "ignored-header",
  ],
  REPLAY_STATUS_LABELS: { REPLAYED: "replayed", FAILED: "failed" },
  EVENT_NAMES: INTERNAL_EVENTS,
  RECURSION_HEADER_VALUE: "Apify-Webhook-Debugger",
  // Backward compatibility for top-level defaults
  DEFAULT_ID_LENGTH: APP_CONSTS.DEFAULT_ID_LENGTH,
  DEFAULT_FIXED_MEMORY_MBYTES: APP_CONSTS.DEFAULT_FIXED_MEMORY_MBYTES,
  TRANSIENT_ERROR_CODES: FORWARDING_CONSTS.TRANSIENT_ERROR_CODES,
  DEFAULT_PAGE_LIMIT: PAGINATION_CONSTS.DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT: PAGINATION_CONSTS.MAX_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET: PAGINATION_CONSTS.DEFAULT_PAGE_OFFSET,
  DEFAULT_PAYLOAD_LIMIT: APP_CONSTS.DEFAULT_PAYLOAD_LIMIT,
  DEFAULT_RETENTION_HOURS: APP_CONSTS.DEFAULT_RETENTION_HOURS,
  DEFAULT_URL_COUNT: APP_CONSTS.DEFAULT_URL_COUNT,
  DEFAULT_RATE_LIMIT_PER_MINUTE: APP_CONSTS.DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_REPLAY_RETRIES: APP_CONSTS.DEFAULT_REPLAY_RETRIES,
  DEFAULT_REPLAY_TIMEOUT_MS: APP_CONSTS.DEFAULT_REPLAY_TIMEOUT_MS,
  ERROR_MESSAGES,
  LOG_MESSAGES,
  PAGINATION_CONSTS,
  HTTP_HEADERS,
  MIME_TYPES,
  ...STORAGE_CONSTS,
  OFFLOAD_MARKER_SYNC: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
  OFFLOAD_MARKER_STREAM: STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
  DEFAULT_OFFLOAD_NOTE: STORAGE_CONSTS.DEFAULT_OFFLOAD_NOTE,
  // Clone frozen objects to extend/modify in tests
  FORWARDING_CONSTS: { ...FORWARDING_CONSTS },
  APP_CONSTS: { ...APP_CONSTS },
};

// Dynamically add getters for overridable constants
createMockWithGetters(constsMock, overridableConsts);

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
    assertType({
      hmac: { update: jest.fn() },
    }),
  ),
  finalizeStreamVerification: jest.fn(() => true),
};

// Add display names for better debugging
Object.defineProperty(signatureMock.verifySignature, "name", {
  value: "verifySignature",
});
Object.defineProperty(signatureMock.createStreamVerifier, "name", {
  value: "createStreamVerifier",
});
Object.defineProperty(signatureMock.finalizeStreamVerification, "name", {
  value: "finalizeStreamVerification",
});

/**
 * Shared Webhook Rate Limiter Mock.
 */
/**
 * @type {jest.Mocked<{['WebhookRateLimiter']: WebhookRateLimiter, webhookRateLimiter: WebhookRateLimiter}>}
 */
export const webhookRateLimiterMock = {
  WebhookRateLimiter: assertType(jest.fn()).mockImplementation(() => ({
    check: jest.fn(() => ({ allowed: true, remaining: 100, resetMs: 0 })),
    limit: 100,
    destroy: jest.fn(),
  })),
  webhookRateLimiter: assertType({
    check: jest.fn(() => ({ allowed: true, remaining: 100, resetMs: 0 })),
    limit: 100,
    entryCount: 0,
    destroy: jest.fn(),
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
    assertType("https://mock-kvs-url"),
  ),
  createReferenceBody: jest.fn((opts) =>
    assertType({ ...assertType(opts), isReference: true }),
  ),
  OFFLOAD_MARKER_STREAM: STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
  OFFLOAD_MARKER_SYNC: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
};

/**
 * Shared Hmac Mock.
 */
/**
 * @type {jest.Mocked<Crypto['Hmac']>}
 */
export const mockHmac = assertType({
  update: jest.fn().mockReturnThis(),
  digest: jest.fn().mockReturnValue("mock-hmac-digest"),
});

/**
 * Shared Crypto Mock.
 */
/**
 * @type {jest.Mocked<Crypto>}
 */
export const cryptoMock = assertType({
  createHmac: jest.fn(() => mockHmac),
});

/**
 * Shared Crypto Utils Mock.
 */
/**
 * @type {jest.Mocked<CryptoUtils>}
 */
export const cryptoUtilsMock = assertType({
  secureCompare: jest.fn((a, b) => a === b),
});

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
    defaultResponseBody: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
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
 * @type {jest.Mocked<{appEvents: {emit: (event: string, data: any) => void, on: (event: string, listener: (data: any) => void) => void, off: (event: string, listener: (data: any) => void) => void}, EVENTS: {LOG_RECEIVED: string}, EVENT_NAMES: typeof INTERNAL_EVENTS}>}
 */
export const eventsMock = {
  appEvents: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
  EVENTS: {
    LOG_RECEIVED: INTERNAL_EVENTS.LOG_RECEIVED,
  },
  EVENT_NAMES: INTERNAL_EVENTS,
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
/**
 * @type {jest.Mocked<FsWithPromises['promises']>}
 */
export const fsPromisesMock = assertType({
  access: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
  mkdir: jest.fn(),
  rm: jest.fn(),
  unlink: jest.fn(),
  watch: jest.fn(),
});

/**
 * Shared FS Mock.
 */
/**
 * @type {jest.Mocked<FsWithPromises>}
 */
export const fsMock = assertType({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  ...fsPromisesMock,
});

/**
 * Shared Forwarding Service Mock.
 */
/** @type {jest.Mocked<ForwardingService>} */
export const forwardingServiceMock = assertType({
  sendSafeRequest: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue({
    status: HTTP_STATUS.OK,
    data: SHARED_CONSTS.FORWARDING_RESPONSE_DATA,
    headers: {},
  }),
  forwardWebhook: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
    undefined,
  ),
  circuitBreaker: assertType({
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  }),
});

/**
 * Shared Services File Mock.
 */
/** @type {jest.Mocked<{forwardingService: ForwardingService, syncService: SyncService}>} */
export const servicesFileMock = {
  forwardingService: forwardingServiceMock,
  syncService: syncServiceMock,
};

/**
 * Mock object for src/consts/app.js
 * Proxies configured values to constsMock/overridableConsts
 */
export const appConstsFileMock = {
  APP_CONSTS: {
    ...APP_CONSTS,
    get DEFAULT_PAYLOAD_LIMIT() {
      return constsMock.DEFAULT_PAYLOAD_LIMIT;
    },
    get DEFAULT_RETENTION_HOURS() {
      return constsMock.DEFAULT_RETENTION_HOURS;
    },
    get DEFAULT_URL_COUNT() {
      return constsMock.DEFAULT_URL_COUNT;
    },
    get DEFAULT_RATE_LIMIT_PER_MINUTE() {
      return constsMock.DEFAULT_RATE_LIMIT_PER_MINUTE;
    },
    get DEFAULT_REPLAY_RETRIES() {
      return constsMock.DEFAULT_REPLAY_RETRIES;
    },
    get DEFAULT_REPLAY_TIMEOUT_MS() {
      return constsMock.DEFAULT_REPLAY_TIMEOUT_MS;
    },
    get DEFAULT_FIXED_MEMORY_MBYTES() {
      return constsMock.DEFAULT_FIXED_MEMORY_MBYTES;
    },
    get MAX_SAFE_RESPONSE_DELAY_MS() {
      return constsMock.MAX_SAFE_RESPONSE_DELAY_MS;
    },
  },
  ENV_VARS,
  WEBHOOK_ID_PREFIX,
  REQUEST_ID_PREFIX,
  SYSTEM_CONSTS,
  INTERNAL_EVENTS,
  REPLAY_STATUS_LABELS,
  EVENT_MAX_LISTENERS,
  APP_ROUTES,
  FORWARDING_CONSTS,
  SORT_DIRECTIONS: { ...SORT_DIRECTIONS },
};

/**
 * Mock object for src/consts/database.js
 * Proxies configured values to constsMock
 */
export const databaseConstsFileMock = {
  get SYNC_BATCH_SIZE() {
    return constsMock.SYNC_BATCH_SIZE;
  },
  get SYNC_MAX_CONCURRENT() {
    return constsMock.SYNC_MAX_CONCURRENT;
  },
  get SYNC_MIN_TIME_MS() {
    return constsMock.SYNC_MIN_TIME_MS;
  },
  get DUCKDB_POOL_SIZE() {
    return constsMock.DUCKDB_POOL_SIZE;
  },
  get DUCKDB_VACUUM_ENABLED() {
    return constsMock.DUCKDB_VACUUM_ENABLED;
  },
  get DUCKDB_VACUUM_INTERVAL_MS() {
    return constsMock.DUCKDB_VACUUM_INTERVAL_MS;
  },
  DUCKDB_STORAGE_DIR_DEFAULT,
  DUCKDB_FILENAME_DEFAULT,
  DUCKDB_MEMORY_LIMIT,
  DUCKDB_THREADS,
  SQL_FRAGMENTS,
  DB_MISSING_OFFSET_MARKER,
  PAGINATION_CONSTS,
  DUCKDB_TABLES,
};

/**
 * Shared System Mock.
 */
/**
 * @type {jest.Mocked<{exit: (code?: number) => never}>}
 */
export const systemMock = {
  exit: jest.fn(),
};

