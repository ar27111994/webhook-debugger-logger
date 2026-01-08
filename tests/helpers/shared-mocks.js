import { jest } from "@jest/globals";
import { createApifyMock } from "./apify-mock.js";

/**
 * Standard axios mock for mirroring internal behavior.
 */
// @ts-expect-error - Mock typing limitation with @types/jest 30
const axiosBase = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-expect-error - Mock typing limitation with @types/jest 30
axiosBase.post = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-expect-error - Mock typing limitation with @types/jest 30
axiosBase.get = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-expect-error - Mock typing limitation with @types/jest 30
axiosBase.delete = jest.fn().mockResolvedValue({ status: 200, data: "OK" });
// @ts-expect-error - Mock typing limitation with @types/jest 30
axiosBase.put = jest.fn().mockResolvedValue({ status: 200, data: "OK" });

export const axiosMock = axiosBase;

/**
 * Minimal Apify Actor mock for basic tests.
 */
export const apifyMock = createApifyMock();
