import { jest } from "@jest/globals";
import { createApifyMock } from "./apify-mock.js";

/**
 * @typedef {import("apify").Dataset} Dataset
 * @typedef {import("apify").DatasetDataOptions} DatasetDataOptions
 * @typedef {jest.MockedFunction<any> & { get: jest.Mock; post: jest.Mock; delete: jest.Mock; put: jest.Mock }} AxiosMock
 * @typedef {import("./apify-mock.js").KeyValueStoreMock} KeyValueStoreMock
 * @typedef {import("./apify-mock.js").ApifyMock} ApifyMock
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
export const apifyMock = createApifyMock();

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
 * @returns {KeyValueStoreMock}
 */
export const createKeyValueStoreMock = () => ({
  getValue: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(null),
  setValue: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
    undefined,
  ),
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
  return {
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
  };
}
