/**
 * Test Helper Utilities.
 *
 * These are used in tests to provide common functionality.
 *
 * @module tests/setup/helpers/test-utils
 */

import { jest } from "@jest/globals";
import { HTTP_METHODS, HTTP_STATUS } from "../../../src/consts/http.js";
import { ERROR_MESSAGES } from "../../../src/consts/errors.js";

const DEFAULT_WAIT_TIMEOUT = 1000;
const DEFAULT_WAIT_INTERVAL = 10;
const DEFAULT_TICKS = 20;

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
export const createMockRequest = (overrides = {}) => {
  const req = /** @type {Request} */ ({
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
    params: { id: "wh_test_123" },
    path: "/test",
    url: "/test",
    originalUrl: "/test",
    method: HTTP_METHODS.POST,
    requestId: "test_req_123", // Default requestId for error handler tests
    get: (/** @type {string} */ header) => {
      const normalizedHeader = header.toLowerCase();

      if (normalizedHeader === "host") return "localhost";

      const headerEntry = Object.entries(req.headers).find(
        ([headerName]) => headerName.toLowerCase() === normalizedHeader,
      );

      if (!headerEntry) return undefined;

      const [, headerValue] = headerEntry;

      if (Array.isArray(headerValue)) {
        return headerValue.join(", ");
      }

      if (typeof headerValue === "string") return headerValue;

      return headerValue == null ? undefined : String(headerValue);
    },
    ...(() => {
      /** @type {Record<string, Function[]>} */
      const listeners = {};
      return {
        on: jest.fn(
          /**
           * @param {string} event
           * @param {Function} handler
           * @returns {Request}
           */
          (event, handler) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
            return req;
          },
        ),
        emit: jest.fn(
          /**
           * @param {string} event
           * @param {...any} args
           * @returns {boolean}
           */
          (event, ...args) => {
            if (listeners[event]) {
              listeners[event].forEach((h) => h(...args));
              return true;
            }
            return false;
          },
        ),
        pipe: jest.fn((stream) => stream),
        unpipe: jest.fn(),
      };
    })(),
    ...overrides,
  });
  return req;
};

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
    writeHead: jest.fn(),
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
      /**
       * @param {string} event
       * @param {Function} handler
       * @returns {Response}
       */
      (event, handler) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
        return res;
      },
    ),
    emit: jest.fn(
      /**
       * @param {string} event
       * @param {...any} args
       * @returns {boolean}
       */
      (event, ...args) => {
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
  timeout = DEFAULT_WAIT_TIMEOUT,
  interval = DEFAULT_WAIT_INTERVAL,
) => {
  const start = Date.now();
  while (true) {
    if (await condition()) return;
    if (Date.now() - start > timeout) {
      throw new Error(ERROR_MESSAGES.CONDITION_NOT_MET(timeout));
    }
    await sleep(interval);
  }
};

/**
 * Gets the last call to axios mock for a specific method.
 *
 * @param {jest.Mocked<AxiosStatic> | any} axios - Axios mock
 * @param {HTTP_METHODS | null} [method='POST'] - HTTP method. Pass null for direct axios() calls.
 * @returns {any[] | undefined} Call arguments
 *
 * @example
 * const lastPost = getLastAxiosCall(axiosMock, 'POST');
 * const lastDirect = getLastAxiosCall(axiosMock, null);
 */
export function getLastAxiosCall(axios, method = HTTP_METHODS.POST) {
  const mockFn = method
    ? /** @type {jest.Mock} */ (axios[method.toLowerCase()])
    : /** @type {jest.Mock} */ (axios);
  const calls = mockFn.mock.calls;
  return calls[calls.length - 1];
}

/**
 * Gets config from last axios call.
 *
 * @param {jest.Mocked<AxiosStatic> | any} axios
 * @param {HTTP_METHODS | null} [method='POST']
 * @returns {any}
 *
 * @example
 * const config = getLastAxiosConfig(axiosMock);
 */
export function getLastAxiosConfig(axios, method = HTTP_METHODS.POST) {
  const call = getLastAxiosCall(axios, method);
  const ARG_INDEX_CONFIG_GET = 1;
  const ARG_INDEX_CONFIG_POST = 2;
  if (!method || method.toUpperCase() === HTTP_METHODS.REQUEST)
    return call?.[0]; // axios(config) or axios.request(config) -> config is 1st arg
  return call?.[
    method.toUpperCase() === HTTP_METHODS.GET
      ? ARG_INDEX_CONFIG_GET
      : ARG_INDEX_CONFIG_POST
  ];
}

/**
 * Flushes the promise queue by awaiting Promise.resolve() multiple times.
 *
 * @param {number} [ticks=20] - Number of times to await Promise.resolve()
 * @returns {Promise<void>}
 *
 * @example
 * await flushPromises();
 */
export const flushPromises = async (ticks = DEFAULT_TICKS) => {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
};
