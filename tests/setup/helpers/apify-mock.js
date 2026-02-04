import { jest } from "@jest/globals";

/**
 * @typedef {Object} KeyValueStoreMock
 * @property {jest.Mock<(key: string) => Promise<any>>} getValue
 * @property {jest.Mock<(key: string, value: any, options?: any) => Promise<void>>} setValue
 * @property {jest.Mock<(key: string) => Promise<string>>} [getPublicUrl]
 */

/**
 * @typedef {Object} DatasetMock
 * @property {jest.Mock<() => Promise<{ items: any[] }>>} getData
 * @property {jest.Mock<(data: any) => Promise<void>>} pushData
 * @property {jest.Mock<() => Promise<{ itemCount: number }>>} getInfo
 */

/**
 * @typedef {Object} ApifyMock
 * @property {jest.Mock<() => Promise<any>>} init
 * @property {jest.Mock<() => Promise<any>>} getInput
 * @property {jest.Mock<() => Promise<KeyValueStoreMock>>} openKeyValueStore
 * @property {jest.Mock<() => Promise<DatasetMock>>} openDataset
 * @property {jest.Mock<(data: any) => Promise<void>>} pushData
 * @property {jest.Mock<(event: string, handler: Function) => void>} on
 * @property {function(any): Promise<void>} emitInput
 * @property {jest.Mock<(code?: number) => Promise<void>>} exit
 * @property {jest.Mock<() => boolean>} isAtHome
 * @property {jest.Mock<() => any>} getEnv
 */

/**
 * Creates or retrieves a standard Apify Actor mock structure for testing.
 *
 * @param {Object} inputOverrides - Custom values for Actor.getInput()
 * @returns {ApifyMock} Mocked Actor object
 */
// Singleton instances for the test module context
/** @type {KeyValueStoreMock} */
const defaultStore = {
  getValue: /** @type {jest.Mock<KeyValueStoreMock['getValue']>} */ (
    jest.fn()
  ).mockResolvedValue(null),
  setValue: /** @type {jest.Mock<KeyValueStoreMock['setValue']>} */ (
    jest.fn()
  ).mockResolvedValue(undefined),
};

/** @type {DatasetMock} */
const defaultDataset = {
  getData: /** @type {jest.Mock<DatasetMock['getData']>} */ (
    jest.fn()
  ).mockResolvedValue({ items: [] }),
  pushData: /** @type {jest.Mock<DatasetMock['pushData']>} */ (
    jest.fn()
  ).mockResolvedValue(undefined),
  getInfo: /** @type {jest.Mock<DatasetMock['getInfo']>} */ (
    jest.fn()
  ).mockResolvedValue({ itemCount: 0 }),
};

/**
 * Creates or retrieves a standard Apify Actor mock structure for testing.
 *
 * @param {Object} inputOverrides - Custom values for Actor.getInput()
 * @returns {ApifyMock} Mocked Actor object
 */
export function createApifyMock(inputOverrides = {}) {
  /** @type {Function | undefined} */
  let inputHandler;

  /** @type {ApifyMock} */
  const actorInstance = {
    init: /** @type {jest.Mock<() => Promise<any>>} */ (
      jest.fn()
    ).mockResolvedValue(undefined),
    getInput: /** @type {jest.Mock<() => Promise<any>>} */ (
      jest.fn()
    ).mockResolvedValue(inputOverrides),
    openKeyValueStore:
      /** @type {jest.Mock<() => Promise<KeyValueStoreMock>>} */ (
        jest.fn()
      ).mockResolvedValue(defaultStore),
    openDataset: /** @type {jest.Mock<() => Promise<DatasetMock>>} */ (
      jest.fn()
    ).mockResolvedValue(defaultDataset),
    pushData: /** @type {jest.Mock<(data: any) => Promise<void>>} */ (
      jest.fn()
    ).mockImplementation(async () => {}),
    on: /** @type {jest.Mock<(event: string, handler: Function) => void>} */ (
      jest.fn((event, handler) => {
        if (event === "input") inputHandler = /** @type {Function} */ (handler);
      })
    ),
    emitInput: /** @param {any} data */ async (data) => {
      // Update the mocked input so subsequent calls to getInput return new data
      actorInstance.getInput.mockResolvedValue(data);

      // Update KV Store 'INPUT' value for live polling
      defaultStore.getValue.mockImplementation(async (key) => {
        if (key === "INPUT") return data;
        return null;
      });

      // Still trigger the handler if one was registered (backward compat for tests/mocks)
      if (inputHandler) await inputHandler(data);
    },
    exit: /** @type {jest.Mock<(code?: number) => Promise<void>>} */ (
      jest.fn()
    ).mockResolvedValue(undefined),
    isAtHome: /** @type {jest.Mock<() => boolean>} */ (
      jest.fn()
    ).mockReturnValue(false),
    getEnv: jest.fn(() => ({
      isAtHome: actorInstance.isAtHome(),
    })),
  };

  return actorInstance;
}
