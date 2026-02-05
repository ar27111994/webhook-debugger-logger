import { jest } from "@jest/globals";
import { HTTP_STATUS } from "../../../src/consts.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 * @typedef {import("axios").AxiosStatic} AxiosStatic
 */

/**
 * Promisified timeout for sleeping in tests.
 * Uses unref() to prevent hanging test processes.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 *
 * @example
 * await sleep(100); // Wait 100ms
 */
export const sleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) t.unref();
  });

/**
 * Creates a mock Express Request object for testing middleware.
 *
 * Provides sensible defaults for all Request properties and allows
 * selective overriding for test-specific scenarios.
 *
 * @param {Partial<Request>} [overrides={}] - Properties to override in the mock request
 * @returns {Request} Mock Express Request object
 *
 * @example
 * const req = createMockRequest({
 *   params: { id: 'wh_123' },
 *   headers: { 'content-type': 'application/json' },
 *   body: { foo: 'bar' }
 * });
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
    path: "/test",
    method: "GET",
    requestId: "test_req_123", // Default requestId for error handler tests
    get: (/** @type {string} */ header) => {
      if (header.toLowerCase() === "host") return "localhost";
      return undefined;
    },
    ...overrides,
  });

/**
 * Creates a mock Express Response object for testing middleware.
 *
 * Includes functional implementations of common Response methods
 * (status, json, send, etc.) with jest mocks for assertions.
 *
 * @param {Partial<Response>} [overrides={}] - Properties to override in the mock response
 * @returns {Response} Mock Express Response object
 *
 * @example
 * const res = createMockResponse();
 * await middleware(req, res, next);
 * expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
 * expect(res.json).toHaveBeenCalledWith({ success: true });
 */
export const createMockResponse = (overrides = {}) => {
  /** @type {Record<string, Function[]>} */
  const listeners = {};
  const res = /** @type {Response} */ ({
    statusCode: HTTP_STATUS.OK,
    headers: {},
    status: jest.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(),
    send: jest.fn(),
    type: jest.fn(
      /** @this {any} */ function () {
        return this;
      },
    ),
    setHeader: jest.fn(
      /** @this {Response} */ function (name, value) {
        // @ts-expect-error - mock headers object
        this.headers[name] = value;
        return this;
      },
    ),
    getHeader: jest.fn(
      /** @this {Response} */ function (name) {
        // @ts-expect-error - mock headers object
        return this.headers[name];
      },
    ),

    end: jest.fn(),
    on: jest.fn(
      /** @param {string} event @param {Function} handler */ (
        event,
        handler,
      ) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
        return res;
      },
    ),
    emit: jest.fn(
      /** @param {string} event @param {...any} args */ (event, ...args) => {
        if (listeners[event]) {
          listeners[event].forEach((h) => h(...args));
          return true;
        }
        return false;
      },
    ),
    ...overrides,
  });
  return res;
};

/**
 * Creates a mock Express NextFunction.
 *
 * @param {jest.Mock} [fn] - Function to call when next is called
 * @returns {NextFunction} Mock jest function
 *
 * @example
 * const next = createMockNextFunction(() => {
 *   throw new Error("Next called");
 * });
 * await middleware(req, res, next);
 */
export const createMockNextFunction = (fn) => jest.fn(fn);

/**
 * Type assertion helper for tests.
 * Useful when casting mocks that don't perfectly match the implemented interface.
 *
 * @template T
 * @param {any} value
 * @returns {T}
 *
 * @example
 * const mockReq = assertType(mockObj);
 */
export const assertType = (value) => value;

/**
 * Waits for a condition to become true.
 *
 * @param {() => boolean | Promise<boolean>} condition
 * @param {number} [timeout=1000] - Max time to wait in ms
 * @param {number} [interval=10] - Interval between checks in ms
 * @returns {Promise<void>}
 *
 * @example
 * await waitForCondition(() => app.isReady());
 */
export const waitForCondition = async (
  condition,
  timeout = 1000,
  interval = 10,
) => {
  const start = Date.now();
  while (true) {
    if (await condition()) return;
    if (Date.now() - start > timeout) {
      throw new Error(`Condition not met within ${timeout}ms`);
    }
    await sleep(interval);
  }
};

/**
 * Gets the last call to axios mock for a specific method.
 *
 * @param {jest.Mocked<AxiosStatic> | any} axios - Axios mock
 * @param {'get'|'post'|'put'|'delete'|null} [method='post'] - HTTP method. Pass null for direct axios() calls.
 * @returns {any[] | undefined} Call arguments
 *
 * @example
 * const lastPost = getLastAxiosCall(axiosMock, 'post');
 * const lastDirect = getLastAxiosCall(axiosMock, null);
 */
export function getLastAxiosCall(axios, method = "post") {
  const mockFn = method
    ? /** @type {jest.Mock} */ (axios[method])
    : /** @type {jest.Mock} */ (axios);
  const calls = mockFn.mock.calls;
  return calls[calls.length - 1];
}

/**
 * Gets config from last axios call.
 *
 * @param {jest.Mocked<AxiosStatic> | any} axios
 * @param {'get'|'post'|'put'|'delete'|null} [method='post']
 * @returns {any}
 *
 * @example
 * const config = getLastAxiosConfig(axiosMock);
 */
export function getLastAxiosConfig(axios, method = "post") {
  const call = getLastAxiosCall(axios, method);
  if (!method) return call?.[0]; // axios(config) -> config is 1st arg
  return call?.[method === "get" ? 1 : 2];
}
