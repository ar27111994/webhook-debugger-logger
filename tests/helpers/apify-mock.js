import { jest } from "@jest/globals";

/**
 * @typedef {Object} KeyValueStoreMock
 * @property {jest.Mock<() => Promise<any>>} getValue
 * @property {jest.Mock<(key: string, value: any) => Promise<void>>} setValue
 */

/**
 * @typedef {Object} DatasetMock
 * @property {jest.Mock<() => Promise<{ items: any[] }>>} getData
 * @property {jest.Mock<(data: any) => Promise<void>>} pushData
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
 */

/**
 * Creates or retrieves a standard Apify Actor mock structure for testing.
 *
 * @param {Object} inputOverrides - Custom values for Actor.getInput()
 * @returns {ApifyMock} Mocked Actor object
 */
export function createApifyMock(inputOverrides = {}) {
  /** @type {KeyValueStoreMock} */
  const store = {
    getValue: /** @type {jest.Mock<(...args: any[]) => Promise<any>>} */ (
      jest.fn()
    ).mockResolvedValue(null),
    setValue:
      /** @type {jest.Mock<(key: string, value: any) => Promise<void>>} */ (
        jest.fn()
      ).mockResolvedValue(undefined),
  };

  /** @type {DatasetMock} */
  const dataset = {
    getData: /** @type {jest.Mock<() => Promise<{ items: any[] }>>} */ (
      jest.fn()
    ).mockResolvedValue({ items: [] }),
    pushData: /** @type {jest.Mock<(data: any) => Promise<void>>} */ (
      jest.fn()
    ).mockResolvedValue(undefined),
  };

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
      ).mockResolvedValue(store),
    openDataset: /** @type {jest.Mock<() => Promise<DatasetMock>>} */ (
      jest.fn()
    ).mockResolvedValue(dataset),
    pushData: /** @type {jest.Mock<(data: any) => Promise<void>>} */ (
      jest.fn()
    ).mockResolvedValue(undefined),
    on: /** @type {jest.Mock<(event: string, handler: Function) => void>} */ (
      jest.fn((event, handler) => {
        if (event === "input") inputHandler = /** @type {Function} */ (handler);
      })
    ),
    emitInput: async (/** @type {any} */ data) => {
      // Update the mocked input so subsequent calls to getInput return new data
      actorInstance.getInput.mockResolvedValue(data);

      // Update KV Store 'INPUT' value for live polling
      store.getValue.mockImplementation(async (/** @type {string} */ key) => {
        if (key === "INPUT") return data;
        return null;
      });

      // Still trigger the handler if one was registered (backward compat for tests/mocks)
      if (inputHandler) await inputHandler(data);
    },
    exit: /** @type {jest.Mock<(code?: number) => Promise<void>>} */ (
      jest.fn()
    ).mockResolvedValue(undefined),
  };

  return actorInstance;
}
