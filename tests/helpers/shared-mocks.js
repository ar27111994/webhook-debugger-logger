import { jest } from "@jest/globals";
import { createApifyMock } from "./apify-mock.js";

/**
 * Standard axios mock for mirroring internal behavior.
 */
// @ts-ignore
const axiosBase = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-ignore
axiosBase.post = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-ignore
axiosBase.get = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-ignore
axiosBase.delete = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-ignore
axiosBase.put = jest.fn().mockResolvedValue({ status: 200, data: "OK" });

export const axiosMock = axiosBase;

/**
 * Minimal Apify Actor mock for basic tests.
 */
export const apifyMock = createApifyMock();
