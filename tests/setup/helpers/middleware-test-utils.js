import { jest } from "@jest/globals";
import { createMockWebhookManager } from "./shared-mocks.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
} from "./test-utils.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('../../../src/typedefs.js').LoggerOptions} LoggerOptions
 * @typedef {import('../../../src/webhook_manager.js').WebhookManager} WebhookManager
 * @typedef {import('../../../src/logger_middleware.js').HotReloadableMiddleware} HotReloadableMiddleware
 * 

/**
 * @typedef {Object} MiddlewareTestContext
 * @property {HotReloadableMiddleware} middleware
 * @property {Request} req
 * @property {Response} res
 * @property {NextFunction} next
 * @property {jest.Mock} onEvent
 * @property {WebhookManager} webhookManager
 */

/**
 * Creates a complete middleware test context.
 *
 * @param {Object} [config={}]
 * @param {LoggerOptions} [config.options] - Middleware options
 * @param {Partial<Request>} [config.request] - Request overrides
 * @param {{ isValid?: boolean, webhookData?: Object }} [config.webhookManager] - WebhookManager mock config
 * @returns {Promise<MiddlewareTestContext>}
 */
export async function createMiddlewareTestContext(config = {}) {
  const { createLoggerMiddleware } =
    await import("../../../src/logger_middleware.js");
  const { options = {}, request = {}, webhookManager: wmOverrides } = config;

  const webhookManager = createMockWebhookManager(wmOverrides);
  const onEvent = jest.fn();
  const middleware = createLoggerMiddleware(webhookManager, options, onEvent);

  return {
    middleware,
    req: createMockRequest(request),
    res: createMockResponse(),
    next: createMockNextFunction(),
    onEvent,
    webhookManager,
  };
}

/**
 * Runs middleware with fake timer support.
 *
 * @param {MiddlewareTestContext} context
 * @returns {Promise<void>}
 */
export async function runMiddlewareWithTimers(context) {
  const p = context.middleware(context.req, context.res, context.next);
  await jest.runAllTimersAsync();
  await p;
}
