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
    getValue: jest.fn().mockResolvedValue(null),
    setValue: jest.fn().mockResolvedValue({}),
  };

  const dataset = {
    getData: jest.fn().mockResolvedValue({ items: [] }),
    pushData: jest.fn().mockResolvedValue({}),
  };

  actorInstance = {
    init: jest.fn().mockResolvedValue({}),
    getInput: jest.fn().mockResolvedValue(inputOverrides),
    openKeyValueStore: jest.fn().mockResolvedValue(store),
    openDataset: jest.fn().mockResolvedValue(dataset),
    pushData: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
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
