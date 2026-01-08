import { jest } from "@jest/globals";

let actorInstance = null;

/**
 * Creates or retrieves a standard Apify Actor mock structure for testing.
 *
 * @param {Object} inputOverrides - Custom values for Actor.getInput()
 * @returns {Object} Mocked Actor object
 */
export function createApifyMock(inputOverrides = {}) {
  if (actorInstance) {
    // Update input if provided
    actorInstance.getInput.mockResolvedValue(inputOverrides);
    return actorInstance;
  }

  const store = {
    // @ts-ignore
    getValue: jest.fn().mockResolvedValue(null),
    // @ts-ignore
    setValue: jest.fn().mockResolvedValue({}),
  };

  const dataset = {
    // @ts-ignore
    getData: jest.fn().mockResolvedValue({ items: [] }),
    // @ts-ignore
    pushData: jest.fn().mockResolvedValue({}),
  };

  let inputHandler;

  actorInstance = {
    // @ts-ignore
    init: jest.fn().mockResolvedValue({}),
    // @ts-ignore
    getInput: jest.fn().mockResolvedValue(inputOverrides),
    // @ts-ignore
    openKeyValueStore: jest.fn().mockResolvedValue(store),
    // @ts-ignore
    openDataset: jest.fn().mockResolvedValue(dataset),
    // @ts-ignore
    pushData: jest.fn().mockResolvedValue({}),
    on: jest.fn((event, handler) => {
      if (event === "input") inputHandler = handler;
    }),
    emitInput: async (data) => {
      if (inputHandler) await inputHandler(data);
    },
    // @ts-ignore
    exit: jest.fn().mockResolvedValue({}),
  };

  return actorInstance;
}

/**
 * Resets the mocked Actor singleton.
 */
export function resetApifyMock() {
  actorInstance = null;
}
