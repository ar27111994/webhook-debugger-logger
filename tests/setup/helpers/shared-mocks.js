import { jest } from "@jest/globals";
import { createApifyMock } from "./apify-mock.js";
import { assertType } from "./test-utils.js";

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
 */

/**
 * Standard axios mock for mirroring internal behavior.
 */
const axiosBase = /** @type {AxiosMock} */ (jest.fn());

axiosBase.mockResolvedValue({ status: 200, data: "OK" });
axiosBase.post = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: 200,
  data: "OK",
});
axiosBase.get = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: 200,
  data: "OK",
});
axiosBase.delete = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: 200,
  data: "OK",
});
axiosBase.put = /** @type {AxiosMock} */ (jest.fn()).mockResolvedValue({
  status: 200,
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
 * SSRF Utils Mock
 */
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
  SSRF_ERRORS: {
    INVALID_URL: "Invalid URL format",
    PROTOCOL_NOT_ALLOWED: "Only http/https URLs are allowed",
    CREDENTIALS_NOT_ALLOWED: "Credentials in URL are not allowed",
    HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname",
    INVALID_IP: "URL resolves to invalid IP address",
    INTERNAL_IP: "URL resolves to internal/reserved IP range",
    VALIDATION_FAILED: "URL validation failed",
  },
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
  axiosMock.mockResolvedValue({ status: 200, data: "OK" });
  axiosMock.post.mockResolvedValue({ status: 200, data: "OK" });
  axiosMock.get.mockResolvedValue({ status: 200, data: "OK" });
};

/**
 * @typedef {import('../../../src/webhook_manager.js').WebhookManager} WebhookManager
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
    STATE_KEY: "WEBHOOK_STATE",
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
 * @type {jest.Mocked<{getDbInstance: jest.Mock<() => Promise<DuckDBInstance>>, executeQuery: jest.Mock<(query: string) => Promise<(Record<string, DuckDBValue>)[]>>}>}
 */
export const duckDbMock = {
  getDbInstance: assertType(jest.fn()).mockResolvedValue({}),
  executeQuery: assertType(jest.fn().mockResolvedValue(assertType([]))),
};

/**
 * @typedef {Object} SyncServiceMock
 * @property {jest.Mock<() => Promise<void>>} start
 * @property {jest.Mock<() => void>} stop
 */

/**
 * Shared SyncService Mock.
 */
/**
 * @type {SyncServiceMock}
 */
export const syncServiceMock = {
  start: jest.fn(),
  stop: jest.fn(),
};

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

/**
 * Shared Consts Mock.
 */
/**
 * @type {jest.Mocked<{CLEANUP_INTERVAL_MS: number, INPUT_POLL_INTERVAL_PROD_MS: number, INPUT_POLL_INTERVAL_TEST_MS: number, SHUTDOWN_TIMEOUT_MS: number, SSE_HEARTBEAT_INTERVAL_MS: number, STARTUP_TEST_EXIT_DELAY_MS: number, DEFAULT_URL_COUNT: number, DEFAULT_RETENTION_HOURS: number, DEFAULT_PAYLOAD_LIMIT: number, MAX_SAFE_URL_COUNT: number, MAX_SAFE_RETENTION_HOURS: number, MAX_SAFE_RATE_LIMIT_PER_MINUTE: number, MAX_ALLOWED_PAYLOAD_SIZE: number, MAX_SAFE_REPLAY_RETRIES: number, MAX_SAFE_REPLAY_TIMEOUT_MS: number, MAX_SAFE_FORWARD_RETRIES: number, MAX_SAFE_RESPONSE_DELAY_MS: number, DEFAULT_RATE_LIMIT_PER_MINUTE: number, DEFAULT_REPLAY_RETRIES: number, DEFAULT_REPLAY_TIMEOUT_MS: number, DEFAULT_FORWARD_RETRIES: number, FORWARD_TIMEOUT_MS: number, RETRY_BASE_DELAY_MS: number, TRANSIENT_ERROR_CODES: string[], SENSITIVE_HEADERS: string[]}>}
 */
export const constsMock = assertType({
  CLEANUP_INTERVAL_MS: 100,
  INPUT_POLL_INTERVAL_PROD_MS: 100,
  INPUT_POLL_INTERVAL_TEST_MS: 100,
  SHUTDOWN_TIMEOUT_MS: 100,
  SSE_HEARTBEAT_INTERVAL_MS: 100,
  STARTUP_TEST_EXIT_DELAY_MS: 100,
  DEFAULT_URL_COUNT: 1,
  DEFAULT_RETENTION_HOURS: 24,
  DEFAULT_PAYLOAD_LIMIT: 1000,
  MAX_SAFE_URL_COUNT: 50,
  MAX_SAFE_RETENTION_HOURS: 168,
  MAX_SAFE_RATE_LIMIT_PER_MINUTE: 1000,
  MAX_ALLOWED_PAYLOAD_SIZE: 100000,
  MAX_SAFE_REPLAY_RETRIES: 3,
  MAX_SAFE_REPLAY_TIMEOUT_MS: 1000,
  MAX_SAFE_FORWARD_RETRIES: 3,
  MAX_SAFE_RESPONSE_DELAY_MS: 1000,
  DEFAULT_RATE_LIMIT_PER_MINUTE: 60,
  DEFAULT_REPLAY_RETRIES: 3,
  DEFAULT_REPLAY_TIMEOUT_MS: 1000,
  DEFAULT_FORWARD_RETRIES: 3,
  FORWARD_TIMEOUT_MS: 1000,
  RETRY_BASE_DELAY_MS: 100,
  TRANSIENT_ERROR_CODES: ["ECONNABORTED", "ECONNRESET"],
  SENSITIVE_HEADERS: ["authorization"],
  SYNC_BATCH_SIZE: 10,
  SYNC_MAX_CONCURRENT: 1,
  SYNC_MIN_TIME_MS: 0,
  MAX_SSE_CLIENTS: 2,
  ERROR_MESSAGES: { HOSTNAME_RESOLUTION_FAILED: "Hostname Resolution Failed" },
  REPLAY_HEADERS_TO_IGNORE: [
    "content-length",
    "host",
    "connection",
    "ignored-header",
  ],
});

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
 * @type {jest.Mocked<{verifySignature: (data: any, signature: string) => {valid: boolean, provider: SignatureProvider}, createStreamVerifier: (stream: any) => {hmac: {update: jest.Mock}}, finalizeStreamVerification: (stream: any) => boolean}>}}
 */
export const signatureMock = {
  verifySignature: jest.fn(() => ({ valid: true, provider: "github" })),
  createStreamVerifier: jest.fn(() => ({ hmac: { update: jest.fn() } })),
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
 * @type {jest.Mocked<{generateKvsKey: (key: string) => string, offloadToKvs: (body: any) => Promise<{isReference: boolean, key: string}>, getKvsUrl: (key: string) => Promise<string>, createReferenceBody: (opts: any) => any, OFFLOAD_MARKER_STREAM: string, OFFLOAD_MARKER_SYNC: string}>}}
 */
export const storageHelperMock = {
  generateKvsKey: jest.fn(() => "mock-kvs-key"),
  offloadToKvs: assertType(jest.fn()).mockResolvedValue(
    assertType({
      isReference: true,
      key: "mock-kvs-key",
    }),
  ),
  getKvsUrl: assertType(jest.fn()).mockResolvedValue(
    assertType("http://mock-kvs-url"),
  ),
  createReferenceBody: jest.fn((opts) =>
    assertType({ ...assertType(opts), isReference: true }),
  ),
  OFFLOAD_MARKER_STREAM: "STREAM_MARKER",
  OFFLOAD_MARKER_SYNC: "SYNC_MARKER",
};

/**
 * Shared Config Mock.
 */
/**
 * @type {jest.Mocked<{getSafeResponseDelay: (opts: any) => any, parseWebhookOptions: (opts: any) => any}>}
 */
export const configMock = {
  getSafeResponseDelay: jest.fn(() => 0),
  parseWebhookOptions: jest.fn((opts) => opts || {}),
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
    LOG_RECEIVED: "LOG_RECEIVED",
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
});
