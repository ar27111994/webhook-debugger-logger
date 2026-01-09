import { jest } from "@jest/globals";
import { createApifyMock } from "./apify-mock.js";

/**
 * @typedef {jest.MockedFunction<any> & { get: jest.Mock; post: jest.Mock; delete: jest.Mock; put: jest.Mock }} AxiosMock
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
export const dnsPromisesMock = {
  resolve4: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue([
    "93.184.216.34",
  ]),
  resolve6: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue([]),
};

/**
 * Creates a mock dataset with predefined items.
 * @param {Array<any>} [items]
 * @returns {{ getData: jest.Mock, pushData: jest.Mock }}
 */
export const createDatasetMock = (items = []) => ({
  getData: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue({
    items,
  }),
  pushData: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
    undefined,
  ),
});
