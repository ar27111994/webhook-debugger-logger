import { jest } from "@jest/globals";

/**
 * Standard axios mock for mirroring internal behavior.
 */
export const axiosMock = {
  post: jest.fn().mockResolvedValue({ status: 200, data: "OK" }),
  get: jest.fn().mockResolvedValue({ status: 200, data: "OK" }),
};

/**
 * Minimal Apify Actor mock for basic tests.
 */
export const apifyMock = {
  init: jest.fn().mockResolvedValue({}),
  exit: jest.fn().mockResolvedValue({}),
  pushData: jest.fn().mockResolvedValue({}),
  on: jest.fn(),
  getInput: jest.fn().mockResolvedValue({}),
  openDataset: jest.fn().mockResolvedValue({
    pushData: jest.fn().mockResolvedValue({}),
    getData: jest.fn().mockResolvedValue({ items: [] }),
  }),
  openKeyValueStore: jest.fn().mockResolvedValue({
    getValue: jest.fn().mockResolvedValue(null),
    setValue: jest.fn().mockResolvedValue({}),
  }),
};
