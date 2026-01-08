import { jest } from "@jest/globals";

/**
 * Creates or retrieves a standard Apify Actor mock structure for testing.
 *
 * @param {Object} inputOverrides - Custom values for Actor.getInput()
 * @returns {Object} Mocked Actor object
 */
export function createApifyMock(inputOverrides = {}) {
  const store = {
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    getValue: jest.fn().mockResolvedValue(null),
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    setValue: jest.fn().mockResolvedValue({}),
  };

  const dataset = {
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    getData: jest.fn().mockResolvedValue({ items: [] }),
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    pushData: jest.fn().mockResolvedValue({}),
  };

  /** @type {Function | undefined} */
  let inputHandler;

  const actorInstance = {
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    init: jest.fn().mockResolvedValue({}),
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    getInput: jest.fn().mockResolvedValue(inputOverrides),
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    openKeyValueStore: jest.fn().mockResolvedValue(store),
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    openDataset: jest.fn().mockResolvedValue(dataset),
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    pushData: jest.fn().mockResolvedValue({}),
    on: jest.fn((event, handler) => {
      if (event === "input") inputHandler = /** @type {Function} */ (handler);
    }),
    emitInput: async (/** @type {any} */ data) => {
      if (inputHandler) await inputHandler(data);
    },
    // @ts-expect-error - Mock typing limitation with @types/jest 30
    exit: jest.fn().mockResolvedValue({}),
  };

  return actorInstance;
}
