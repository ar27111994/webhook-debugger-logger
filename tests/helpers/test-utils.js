import { jest } from "@jest/globals";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 */

/**
 * Promisified timeout for sleeping.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) t.unref();
  });

/**
 * Creates a mock Express request object.
 * @param {Partial<Request>} overrides
 * @returns {Request}
 */
export const createMockRequest = (overrides = {}) =>
  /** @type {Request} */ ({
    ip: undefined,
    headers: {},
    socket: { remoteAddress: undefined },
    accepted: [],
    acceptedLanguages: [],
    acceptedCharsets: [],
    acceptedEncodings: [],
    baseUrl: "",
    body: {},
    cookies: {},
    fresh: false,
    hostname: "",
    ips: [],
    protocol: "http",
    query: {},
    route: {},
    params: {},
    ...overrides,
  });

/**
 * Creates a mock Express response object.
 * @param {Partial<Response>} overrides
 * @returns {Response}
 */
export const createMockResponse = (overrides = {}) =>
  /** @type {Response} */ ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    ...overrides,
  });

/**
 * Creates a mock Express next function.
 * @param {NextFunction} fn
 * @returns {NextFunction}
 */
export const createMockNextFunction = (fn = jest.fn()) => fn;
