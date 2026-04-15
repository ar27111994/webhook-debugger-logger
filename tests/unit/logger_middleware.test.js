/**
 * @file tests/unit/logger_middleware.test.js
 * @description Unit tests for LoggerMiddleware core logic.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  useMockCleanup,
  useFakeTimers,
} from "../setup/helpers/test-lifecycle.js";
import { assertType, flushPromises } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/logger_middleware.js').LoggerMiddleware} LoggerMiddleware
 * @typedef {import('../../src/typedefs.js').CustomRequest} CustomRequest
 * @typedef {import('../../src/typedefs.js').CommonError} CommonError
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../../src/utils/logger.js').SerializedError} SerializedError
 */

await setupCommonMocks({
  apify: true,
  logger: true,
  repositories: true,
  alerting: true,
  auth: true,
  signature: true,
  consts: true,
  ssrf: true,
  config: true,
});

const {
  HTTP_HEADERS,
  HTTP_STATUS,
  HTTP_METHODS,
  MIME_TYPES,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
  HTTP_CONSTS,
  HTTP_STATUS_MESSAGES,
} = await import("../../src/consts/http.js");

const { ERROR_LABELS, ERROR_MESSAGES, NODE_ERROR_CODES, SIGNATURE_ERRORS } =
  await import("../../src/consts/errors.js");
const { LOG_MESSAGES } = await import("../../src/consts/messages.js");
const { STORAGE_CONSTS } = await import("../../src/consts/storage.js");
const { APP_CONSTS, ENV_VALUES, ENV_VARS, STREAM_EVENTS } =
  await import("../../src/consts/app.js");
const { SIGNATURE_PROVIDERS, SIGNATURE_PREFIXES } =
  await import("../../src/consts/security.js");
const { LOG_CONSTS, LOG_TAGS } = await import("../../src/consts/logging.js");
const { AUTH_CONSTS } = await import("../../src/consts/auth.js");
const { createGitHubSignature } =
  await import("../setup/helpers/signature-utils.js");
const { createMiddlewareTestContext } =
  await import("../setup/helpers/middleware-test-utils.js");
const { createMockRequest, createMockResponse, createMockNextFunction } =
  await import("../setup/helpers/test-utils.js");

// Import dynamically to get mocked modules
const {
  loggerMock,
  webhookManagerMock,
  forwardingServiceMock,
  alertingMock,
  ssrfMock,
  authMock,
  constsMock,
  signatureMock,
  apifyMock,
  configMock,
} = await import("../setup/helpers/shared-mocks.js");

const {
  LoggerMiddleware,
  createLoggerMiddleware,
  restoreSandboxEvent,
  createCustomScriptSafeRequest,
  rehydrateSandboxError,
  normalizeScriptLogArg,
  createScriptLogMessage,
  emitCustomScriptLogs,
} = await import("../../src/logger_middleware.js");
const { appEvents, EVENT_NAMES } = await import("../../src/utils/events.js");
const { webhookRateLimiter } =
  await import("../../src/utils/webhook_rate_limiter.js");

describe("LoggerMiddleware", () => {
  useMockCleanup();
  useFakeTimers();

  /** @type {jest.Mock} */
  let onEventMock;
  const SLOW_SCRIPT_TEST_TIMEOUT_MS = 15000;
  const ONE_MB = APP_CONSTS.BYTES_PER_KB * APP_CONSTS.BYTES_PER_KB;
  const TEST_URL = "https://test";

  beforeEach(() => {
    onEventMock = jest.fn();

    // Reset mocks to prevent leakages
    jest.mocked(webhookManagerMock.getWebhookData).mockReset();
    jest.mocked(webhookManagerMock.isValid).mockReset();
    jest.mocked(apifyMock.pushData).mockReset();

    // Default mock behavior
    jest
      .spyOn(webhookRateLimiter, "check")
      .mockReturnValue({ allowed: true, remaining: 99, resetMs: 1000 });
    apifyMock.pushData.mockResolvedValue(assertType(undefined));
    jest.spyOn(appEvents, "emit").mockImplementation(assertType(() => {}));
    jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);
    jest
      .mocked(webhookManagerMock.getWebhookData)
      .mockReturnValue(assertType({}));

    // Reset overridable constants to defaults
    // Reset to the original default from overridableConsts (not from the mocked APP_CONSTS getter)
    constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS =
      APP_CONSTS.MS_PER_SECOND;
  });

  describe("Instantiation & Options", () => {
    it("should correctly create and assign options", () => {
      const rawOptions = { defaultResponseCode: HTTP_STATUS.ACCEPTED };
      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        rawOptions,
        onEventMock,
        forwardingServiceMock,
      );
      expect(middleware.options.defaultResponseCode).toBe(HTTP_STATUS.ACCEPTED);
      expect(middleware.hasCompiledScript()).toBe(false);
      expect(middleware.hasValidator()).toBe(false);
    });

    it("should compile scripts dynamically if provided", () => {
      const middleware = new LoggerMiddleware(
        webhookManagerMock,
        { customScript: `event.statusCode = ${HTTP_STATUS.CREATED};` },
        onEventMock,
        forwardingServiceMock,
      );
      expect(middleware.hasCompiledScript()).toBe(true);
    });

    it("factory pattern exports correctly configured middleware object", () => {
      const middlewareFn = createLoggerMiddleware(
        webhookManagerMock,
        {},
        onEventMock,
      );
      expect(typeof middlewareFn).toBe("function");
      expect(typeof middlewareFn.updateOptions).toBe("function");
      expect(typeof middlewareFn.ingestMiddleware).toBe("function");
      expect(typeof middlewareFn.hasCompiledScript).toBe("function");
      expect(typeof middlewareFn.hasValidator).toBe("function");
      expect(middlewareFn.hasCompiledScript()).toBe(false);
      expect(middlewareFn.hasValidator()).toBe(false);
      expect(middlewareFn.options).toEqual(
        expect.objectContaining({
          defaultResponseBody: HTTP_CONSTS.DEFAULT_SUCCESS_BODY,
        }),
      );

      const reqMock = assertType({
        url: "/test",
        params: {},
        headers: {},
        method: HTTP_METHODS.GET,
      });
      const resMock = assertType({});
      const nextMock = assertType(jest.fn());
      middlewareFn.ingestMiddleware(reqMock, resMock, nextMock);
      expect(nextMock).toHaveBeenCalled();
    });

    it("should fallback getValidStatusCode on invalid input", () => {
      expect(
        LoggerMiddleware.getValidStatusCode(
          "not-a-number",
          HTTP_STATUS.CREATED,
        ),
      ).toBe(HTTP_STATUS.CREATED);
      expect(
        LoggerMiddleware.getValidStatusCode(HTTP_STATUS.NOT_FOUND.toString()),
      ).toBe(HTTP_STATUS.NOT_FOUND);
      expect(
        LoggerMiddleware.getValidStatusCode(Symbol("forced"), HTTP_STATUS.OK),
      ).toBe(HTTP_STATUS.OK);
    });

    it("should successfully update options at runtime", async () => {
      const customScript = "const y = 2;";
      const { middleware } = await createMiddlewareTestContext();
      middleware.updateOptions({ customScript });
      expect(middleware.options.customScript).toBe(customScript);
    });

    it("should catch compilation errors and log them gracefully", async () => {
      const { middleware } = await createMiddlewareTestContext({
        options: { jsonSchema: '{ invalid: "' },
      });

      expect(middleware.hasValidator()).toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ errorPrefix: LOG_TAGS.SCHEMA_ERROR }),
        LOG_MESSAGES.RESOURCE_INVALID,
      );
    });

    it("should hit oldSchemaStr truthy branch in refreshCompilations directly", () => {
      const mw = createLoggerMiddleware(
        webhookManagerMock,
        { jsonSchema: { type: "string" } },
        () => {},
      );

      // Update with DIFFERENT schema to hit the 'newSchemaStr !== oldSchemaStr' branch
      // where oldSchemaStr IS truthy
      mw.updateOptions({ jsonSchema: { type: "number" } });

      // Just assert it ran smoothly (coverage proves branches taken)
      expect(loggerMock.error).not.toHaveBeenCalledWith(
        expect.objectContaining({ errorPrefix: LOG_TAGS.SCHEMA_ERROR }),
        LOG_MESSAGES.RESOURCE_INVALID,
      );
    });

    it("should hit webhookData nullish fallback in resolveOptions", async () => {
      jest
        .mocked(webhookManagerMock.getWebhookData)
        .mockReturnValue(assertType(null));
      jest.mocked(webhookManagerMock.isValid).mockReturnValue(true);
      // Passing empty options means it has NO webhookId in global options
      const mw = createLoggerMiddleware(webhookManagerMock, {}, () => {});
      const { req, res, next } = await createMiddlewareTestContext();
      req.params.id = "wh_missing_data_resolve";
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
    });

    it("should hit non-Error branch in compileResource catch via bad schema compiler", () => {
      // JSON.parse throws a true Error, but we can mock it to throw a primitive
      // This will trigger the `String(err ?? UNKNOWN)` branch in `#compileResource`
      const spy = jest.spyOn(JSON, "parse").mockImplementationOnce(() => {
        throw null;
      });

      // The string gets sent to JSON.parse by our compilerFn
      createLoggerMiddleware(
        webhookManagerMock,
        { jsonSchema: '{"invalid"' },
        () => {},
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorPrefix: LOG_TAGS.SCHEMA_ERROR,
          message: LOG_MESSAGES.UNKNOWN_ERROR,
        }),
        LOG_MESSAGES.RESOURCE_INVALID,
      );

      spy.mockRestore();
    });

    it("should log invalid custom script compilation errors gracefully", async () => {
      const { middleware } = await createMiddlewareTestContext({
        options: { customScript: "if (" },
      });

      expect(middleware.hasCompiledScript()).toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorPrefix: LOG_TAGS.SCRIPT_ERROR,
          message: expect.any(String),
        }),
        LOG_MESSAGES.RESOURCE_INVALID,
      );
    });

    it("should compile schema when provided as object instead of string", async () => {
      const schemaObj = {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      };
      const { req, res, next, middleware } = await createMiddlewareTestContext({
        options: { jsonSchema: schemaObj },
      });
      expect(middleware.hasValidator()).toBe(true);

      req.body = { id: "not-a-number" };
      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    });

    it("should skip re-compilation when updateOptions has same script", async () => {
      const script = "event.test = true;";
      const { middleware } = await createMiddlewareTestContext({
        options: { customScript: script },
      });
      expect(middleware.hasCompiledScript()).toBe(true);

      // Update with same script — should keep existing compiled script
      middleware.updateOptions({ customScript: script });
      expect(middleware.hasCompiledScript()).toBe(true);
    });
  });

  describe("ingestMiddleware", () => {
    it("should bypass GET/HEAD requests immediately", async () => {
      const { req, res, next, middleware } =
        await createMiddlewareTestContext();

      // Test GET
      req.method = HTTP_METHODS.GET;
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Test HEAD
      req.method = HTTP_METHODS.HEAD;
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1 + 1);

      expect(webhookRateLimiter.check).not.toHaveBeenCalled();

      // Test small POST request to hit fallthrough
      req.method = HTTP_METHODS.POST;
      req.headers[HTTP_HEADERS.CONTENT_LENGTH] = "100"; // Under threshold
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1 + 1 + 1);
    });

    it("should block recursive loop requests via RECURSION_HEADER_NAME", async () => {
      const { req, res, next, middleware } =
        await createMiddlewareTestContext();
      req.method = HTTP_METHODS.POST;
      req.headers[RECURSION_HEADER_NAME] = RECURSION_HEADER_VALUE;

      await middleware.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
          error: HTTP_STATUS_MESSAGES[HTTP_STATUS.UNPROCESSABLE_ENTITY],
          message: ERROR_MESSAGES.RECURSIVE_FORWARDING,
        }),
      );
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: expect.any(String),
          headers: expect.any(Object),
        }),
        ERROR_MESSAGES.RECURSIVE_FORWARDING_BLOCKED,
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should block recursive loop requests via X_FORWARDED_FOR matching RECURSION_HEADER_VALUE", async () => {
      const { req, res, next, middleware } =
        await createMiddlewareTestContext();
      req.method = HTTP_METHODS.POST;
      req.headers[HTTP_HEADERS.X_FORWARDED_FOR] = RECURSION_HEADER_VALUE;

      await middleware.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
      expect(next).not.toHaveBeenCalled();
    });

    it("should block requests over max size limits dynamically", async () => {
      const maxPayloadSize = 100;
      const contentLength = 200;
      const { req, res, next, middleware } = await createMiddlewareTestContext({
        options: { maxPayloadSize },
      });
      req.headers[HTTP_HEADERS.CONTENT_LENGTH] = contentLength.toString(); // Exceeds size 100

      await middleware.ingestMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.PAYLOAD_TOO_LARGE);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: ERROR_MESSAGES.PAYLOAD_TOO_LARGE(maxPayloadSize),
          received: contentLength,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle rate limiting gracefully with exact headers and JSON body", async () => {
      const resetMs = 4999;
      const { req, res, next, middleware } =
        await createMiddlewareTestContext();

      const mockLimit = 60;
      jest.spyOn(webhookRateLimiter, "limit", "get").mockReturnValue(mockLimit);
      jest
        .mocked(webhookRateLimiter.check)
        .mockReturnValue({ allowed: false, remaining: 0, resetMs });

      await middleware.ingestMiddleware(req, res, next);

      const EXPECTED_RETRY_SECONDS = Math.ceil(
        resetMs / APP_CONSTS.MS_PER_SECOND,
      );
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.TOO_MANY_REQUESTS);
      expect(res.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.RETRY_AFTER,
        EXPECTED_RETRY_SECONDS,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.X_RATELIMIT_LIMIT,
        mockLimit,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        HTTP_HEADERS.X_RATELIMIT_REMAINING,
        0,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HTTP_STATUS.TOO_MANY_REQUESTS,
          error: expect.any(String),
          message: ERROR_MESSAGES.WEBHOOK_RATE_LIMIT_EXCEEDED(mockLimit),
          retryAfterSeconds: EXPECTED_RETRY_SECONDS,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should proceed securely without offloading calling next", async () => {
      const { middleware, req, res, next } =
        await createMiddlewareTestContext();
      req.isOffloaded = false;
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should proceed through ingestMiddleware for small non-offloaded POST", async () => {
      const { middleware, req, res, next } =
        await createMiddlewareTestContext();
      req.method = HTTP_METHODS.POST;
      req.headers[HTTP_HEADERS.CONTENT_LENGTH] = "10";
      req.body = "small";

      // Ensure it doesn't hit any early returns
      req.params.id = "wh_small";

      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should handle omitted Content-Length in ingestMiddleware", async () => {
      const { middleware, req, res, next } =
        await createMiddlewareTestContext();
      req.method = HTTP_METHODS.POST;
      delete req.headers[HTTP_HEADERS.CONTENT_LENGTH];
      req.body = "any";
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should warn if stream verifier creation fails", async () => {
      const error = "Failed to init";
      signatureMock.createStreamVerifier.mockReturnValueOnce(
        assertType({ error }),
      );
      const { req, res, next, middleware } = await createMiddlewareTestContext({
        options: {
          maxPayloadSize: APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE,
          signatureVerification: {
            provider: SIGNATURE_PROVIDERS.GITHUB,
            secret: "foo",
          },
        },
      });
      req.headers[HTTP_HEADERS.CONTENT_LENGTH] =
        APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE.toString();
      const mockStream = {
        on: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      };

      req.pipe = assertType(jest.fn(() => mockStream));

      await middleware.ingestMiddleware(req, res, next);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error }),
        LOG_MESSAGES.STREAM_VERIFIER_FAILED,
      );
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: ERROR_LABELS.SIGNATURE_HEADER_MISSING,
          id: expect.any(String),
          docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
        }),
      );
    });

    it("should handle array type for req.params.id", async () => {
      const { middleware, req, res, next } =
        await createMiddlewareTestContext();
      req.method = HTTP_METHODS.POST;
      req.params.id = ["wh_array_id", "wh_array_id2"];
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should handle missing/falsy req.params.id", async () => {
      const { middleware, req, res, next } =
        await createMiddlewareTestContext();
      req.method = HTTP_METHODS.POST;
      // @ts-expect-error - testing falsy fallback
      req.params.id = undefined;
      await middleware.ingestMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("middleware execution (main logic)", () => {
    describe("Core Request Processing", () => {
      it("should reject invalid webhooks with 404", async () => {
        const { req, res, next, middleware, webhookManager } =
          await createMiddlewareTestContext();
        jest.mocked(webhookManager.isValid).mockReturnValue(false);
        const webhookId = "wh_not_found";
        const ipAddress = "127.0.0.1";
        req.params.id = webhookId;
        Object.defineProperty(req, "ip", {
          value: ipAddress,
          writable: false,
          configurable: false,
          enumerable: true,
        });

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: ERROR_MESSAGES.WEBHOOK_NOT_FOUND,
            id: webhookId,
            docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
          }),
        );
      });

      it("should execute basic flow and emit events without error", async () => {
        const defaultResponseBody = { ok: true };
        const { req, res, next, middleware, onEvent } =
          await createMiddlewareTestContext({
            options: {
              defaultResponseCode: HTTP_STATUS.OK,
              defaultResponseBody,
            },
          });

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(res.json).toHaveBeenCalledWith(defaultResponseBody);

        // Advance timers to trigger background promises in race conditions
        await jest.runAllTimersAsync();

        expect(appEvents.emit).toHaveBeenCalledWith(
          EVENT_NAMES.LOG_RECEIVED,
          expect.any(Object),
        );
        expect(onEvent).toHaveBeenCalled();

        /** @type {[WebhookEvent]} */
        const [event] = assertType(onEvent.mock.calls[0]);
        expect(event.timestamp).toBeDefined();
        expect(!isNaN(Date.parse(event.timestamp))).toBe(true);
        expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });
    });

    describe("Security & Validation Logic", () => {
      it("should validate schemas returning 400 if mismatch", async () => {
        const {
          req,
          res,
          next,
          middleware: strictMw,
        } = await createMiddlewareTestContext({
          options: {
            jsonSchema: { type: "object", required: ["mandatory"] },
          },
        });

        const webhookId = "wh_atomic";
        req.body = { test: "payload_without_mandatory" }; // Mismatch
        req.params.id = webhookId;

        await strictMw(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(String), id: webhookId }),
        );
      });

      it("should run custom transformation scripts cleanly and execute console outputs", async () => {
        const payload = "payload_modified";
        const {
          req,
          res,
          next,
          middleware: scriptMw,
        } = await createMiddlewareTestContext({
          options: {
            customScript: `console.log('l'); console.error('e'); console.warn('w'); console.info('i'); event.statusCode = ${HTTP_STATUS.ACCEPTED}; event.responseBody = { test_custom: req.body.test };`,
          },
        });

        req.body = { test: payload };

        await scriptMw(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.ACCEPTED);
        expect(res.json).toHaveBeenCalledWith({ test_custom: payload });
        expect(loggerMock.debug).toHaveBeenCalledWith(
          expect.objectContaining({ source: "script" }),
          "l",
        );
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ source: "script" }),
          "e",
        );
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ source: "script" }),
          "w",
        );
        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ source: "script" }),
          "i",
        );
      });

      it("should serialize structured custom script console output safely", async () => {
        const {
          req,
          res,
          next,
          middleware: scriptMw,
        } = await createMiddlewareTestContext({
          options: {
            customScript:
              "console.error(new Error('boom'), { nested: true }, ['x']);",
          },
        });

        await scriptMw(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            source: "script",
            scriptArgs: [
              expect.objectContaining({
                name: "Error",
                message: "boom",
                stack: expect.any(String),
              }),
              expect.objectContaining({ nested: true }),
              ["x"],
            ],
          }),
          expect.stringContaining("boom"),
        );
      });

      it("should cover defensive custom script log and error fallback branches", () => {
        const circular = {};
        const syntheticErrorMessage = "synthetic boom";
        const defaultScriptLogMessage = "Custom script emitted a log entry";
        const stacklessError = new Error(syntheticErrorMessage);
        circular.self = circular;
        stacklessError.stack = undefined;

        expect(restoreSandboxEvent(undefined)).toEqual(
          expect.objectContaining({
            headers: {},
            query: {},
            params: {},
            responseHeaders: {},
          }),
        );
        expect(
          restoreSandboxEvent(
            assertType({
              responseHeaders: null,
            }),
          ),
        ).toEqual(
          expect.objectContaining({
            headers: {},
            query: {},
            params: {},
            responseHeaders: null,
          }),
        );

        expect(
          createCustomScriptSafeRequest(
            createMockRequest({
              headers: undefined,
              query: undefined,
              params: undefined,
            }),
          ),
        ).toEqual(
          expect.objectContaining({
            headers: {},
            query: {},
            params: {},
          }),
        );

        expect(rehydrateSandboxError(null)).toEqual(
          expect.objectContaining({
            name: "Error",
            message: LOG_MESSAGES.UNKNOWN_ERROR,
          }),
        );
        expect(
          rehydrateSandboxError({
            name: 1,
            message: 2,
            stack: 3,
            code: 4,
          }),
        ).toEqual(
          expect.objectContaining({
            name: "Error",
            message: LOG_MESSAGES.UNKNOWN_ERROR,
            stack: undefined,
            code: undefined,
          }),
        );
        expect(
          rehydrateSandboxError({
            name: "ScriptError",
            message: syntheticErrorMessage,
            stack: "stack-trace",
            code: "E_SCRIPT",
          }),
        ).toEqual(
          expect.objectContaining({
            name: "ScriptError",
            message: syntheticErrorMessage,
            stack: "stack-trace",
            code: "E_SCRIPT",
          }),
        );
        expect(normalizeScriptLogArg(new Error(syntheticErrorMessage))).toEqual(
          expect.objectContaining({
            name: "Error",
            message: syntheticErrorMessage,
            stack: expect.any(String),
          }),
        );
        expect(normalizeScriptLogArg(stacklessError)).toEqual(
          expect.objectContaining({
            name: "Error",
            message: syntheticErrorMessage,
            stack: undefined,
          }),
        );
        expect(
          normalizeScriptLogArg({
            name: "ScriptError",
            message: syntheticErrorMessage,
          }),
        ).toEqual(
          expect.objectContaining({
            name: "ScriptError",
            message: syntheticErrorMessage,
            stack: undefined,
          }),
        );
        expect(createScriptLogMessage([])).toBe(defaultScriptLogMessage);
        expect(createScriptLogMessage([circular])).toBe("[object Object]");

        loggerMock.info.mockClear();
        loggerMock.debug.mockClear();
        loggerMock.warn.mockClear();
        loggerMock.error.mockClear();

        emitCustomScriptLogs(assertType(loggerMock), null);
        emitCustomScriptLogs(assertType(loggerMock), [
          { level: "info", args: [] },
          {
            level: "debug",
            args: [new Error(syntheticErrorMessage)],
          },
          { level: "error" },
          { level: "warn", args: [circular] },
          { level: "trace", args: ["ignored"] },
        ]);

        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ source: "script", scriptArgs: [] }),
          defaultScriptLogMessage,
        );
        expect(loggerMock.debug).toHaveBeenCalledWith(
          expect.objectContaining({
            source: "script",
            scriptArgs: [
              expect.objectContaining({
                name: "Error",
                message: syntheticErrorMessage,
                stack: expect.any(String),
              }),
            ],
          }),
          expect.stringContaining(syntheticErrorMessage),
        );
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ source: "script" }),
          "[object Object]",
        );
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ source: "script", scriptArgs: [] }),
          defaultScriptLogMessage,
        );
      });

      it("should trigger webhook forwarding natively", async () => {
        const {
          req,
          res,
          next,
          middleware: fwdMw,
        } = await createMiddlewareTestContext({
          options: {
            forwardUrl: TEST_URL,
          },
        });

        await fwdMw(req, res, next);
        await jest.runAllTimersAsync();

        expect(forwardingServiceMock.forwardWebhook).toHaveBeenCalledWith(
          expect.objectContaining({
            webhookId: expect.any(String),
            method: HTTP_METHODS.POST,
            statusCode: expect.any(Number),
          }),
          req,
          expect.objectContaining({ forwardUrl: TEST_URL }),
          TEST_URL,
          expect.any(AbortSignal),
        );
      });

      it("should trigger webhook forwarding via per-webhook override when instance lacks config", async () => {
        const {
          req,
          res,
          next,
          middleware: fwdMw,
          webhookManager,
        } = await createMiddlewareTestContext(); // No instance-level forwardUrl

        jest.mocked(webhookManager.getWebhookData).mockReturnValue({
          forwardUrl: TEST_URL, // Webhook-level override
          expiresAt: new Date(
            Date.now() + APP_CONSTS.MS_PER_HOUR,
          ).toISOString(),
        });

        await fwdMw(req, res, next);
        await jest.runAllTimersAsync();

        expect(forwardingServiceMock.forwardWebhook).toHaveBeenCalledWith(
          expect.any(Object),
          req,
          expect.objectContaining({ forwardUrl: TEST_URL }),
          TEST_URL,
          expect.any(AbortSignal),
        );
      });

      it("should prioritize per-webhook forwardUrl over instance-level forwardUrl when configured", async () => {
        const {
          req,
          res,
          next,
          middleware: fwdMw,
          webhookManager,
        } = await createMiddlewareTestContext({
          options: {
            forwardUrl: "https://instance-default.url",
          },
        });
        const overrideUrl = "https://webhook-override.url";

        jest.mocked(webhookManager.getWebhookData).mockReturnValue({
          forwardUrl: overrideUrl,
          expiresAt: new Date(
            Date.now() + APP_CONSTS.MS_PER_HOUR,
          ).toISOString(),
        });

        await fwdMw(req, res, next);
        await jest.runAllTimersAsync();

        expect(forwardingServiceMock.forwardWebhook).toHaveBeenCalledWith(
          expect.any(Object),
          req,
          expect.objectContaining({ forwardUrl: overrideUrl }),
          overrideUrl,
          expect.any(AbortSignal),
        );
      });

      it("should handle req.isOffloaded logic correctly", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.isOffloaded = true;
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;
        req.body = { ref: "offloaded" };

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should fallback to string parsing if JSON parsing fails but header says json", async () => {
        const {
          req,
          res,
          next,
          middleware: mwOptions,
        } = await createMiddlewareTestContext({
          options: { enableJSONParsing: true },
        });
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;
        req.body = "invalid-json-{";

        await mwOptions(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.any(String),
            err: expect.any(Object),
          }),
          ERROR_MESSAGES.JSON_PARSE_ERROR(
            LOG_MESSAGES.JSON_PARSE_FAILED_FALLBACK,
          ),
        ); // Should log warning about JSON parsing fallback
      });

      it("should successfully parse JSON body when enableJSONParsing is true", async () => {
        const {
          req,
          res,
          next,
          middleware: mwOptions,
          onEvent,
        } = await createMiddlewareTestContext({
          options: { enableJSONParsing: true },
        });
        const jsonBody = { foo: "bar" };
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;
        req.body = JSON.stringify(jsonBody);

        const p = mwOptions(req, res, next);
        await jest.runAllTimersAsync();
        await p;

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(req.body).toEqual(jsonBody); // Verify in-place mutation
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ body: JSON.stringify(jsonBody) }),
        );
      });

      it("should securely bypass JSON parsing if content-type is non-json even when enabled", async () => {
        const {
          req,
          res,
          next,
          middleware: mwOptions,
          onEvent,
        } = await createMiddlewareTestContext({
          options: { enableJSONParsing: true },
        });
        const stringBody = '{"foo":"bar"}';
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.TEXT;
        req.body = stringBody;

        const p = mwOptions(req, res, next);
        await jest.runAllTimersAsync();
        await p;

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(req.body).toBe(stringBody); // Verify string body was unmodified
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ body: stringBody }),
        );
      });

      it("should return 401 for unauthorized requests", async () => {
        const {
          req,
          res,
          next,
          middleware: mwAuth,
        } = await createMiddlewareTestContext({
          options: { authKey: "secret-key" },
        });
        req.headers[HTTP_HEADERS.AUTHORIZATION] = "wrong-key";

        await mwAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.any(String),
            id: expect.any(String),
          }),
        );
      });

      it("should verify payload signatures successfully", async () => {
        const {
          req,
          res,
          next,
          middleware: mwSig,
        } = await createMiddlewareTestContext({
          options: {
            signatureVerification: {
              provider: SIGNATURE_PROVIDERS.GITHUB,
              secret: "abc",
            },
          },
        });

        await mwSig(req, res, next);
        // signatureMock.verifySignature returns { valid: true } by default
        expect(signatureMock.verifySignature).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should redact sensitive paths from body", async () => {
        const secret = "super-hidden";
        const {
          req,
          res,
          next,
          middleware: mwRedact,
        } = await createMiddlewareTestContext({
          options: {
            redactBodyPaths: ["body.secret"],
          },
        });

        req.body = { safe: "hello", secret: secret };
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;

        await mwRedact(req, res, next);
        // Core contract: structuredClone protects original req.body from mutation
        expect(req.body.secret).toBe(secret);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        // We can't directly check the internal 'event' variable, but we could spy on pushData or onEventMock
        expect(appEvents.emit).toHaveBeenCalledWith(
          EVENT_NAMES.LOG_RECEIVED,
          expect.objectContaining({
            body: JSON.stringify({
              safe: "hello",
              secret: LOG_CONSTS.CENSOR_MARKER,
            }),
          }),
        );
      });

      it("should merge webhook options securely, ignoring unallowed keys", async () => {
        const { req, res, next, middleware, webhookManager } =
          await createMiddlewareTestContext();
        jest.mocked(webhookManager.getWebhookData).mockReturnValueOnce(
          assertType({
            defaultResponseCode: HTTP_STATUS.ACCEPTED,
            notAllowedKey: "malicious",
          }),
        );

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.ACCEPTED);
        expect(middleware.options).not.toHaveProperty("notAllowedKey");
      });

      it("should trigger webhook forwarding and handle abort controller correctly", async () => {
        const {
          req,
          res,
          next,
          middleware: fwdMw,
        } = await createMiddlewareTestContext({
          options: { forwardUrl: TEST_URL },
        });

        await fwdMw(req, res, next);

        // Immediately run timers to process background task
        await jest.runAllTimersAsync();

        expect(forwardingServiceMock.forwardWebhook).toHaveBeenCalled();
      });
    });

    describe("Error Handling & Resilience", () => {
      it("should catch and log sync middleware errors gracefully", async () => {
        const {
          req,
          res,
          next,
          middleware: errMw,
        } = await createMiddlewareTestContext();

        // Induce an error by making request completely invalid or spying on an internal method
        jest
          .spyOn(LoggerMiddleware, "getValidStatusCode")
          .mockImplementation(() => {
            throw new Error("Simulated failure");
          });
        Object.defineProperty(req, "method", {
          get: () => {
            throw new Error("Method read error");
          },
        });

        await errMw(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
      });

      it("should log errors instead of calling next if headers are already sent", async () => {
        const {
          req,
          res,
          next,
          middleware: errMw,
        } = await createMiddlewareTestContext();

        jest
          .spyOn(LoggerMiddleware, "getValidStatusCode")
          .mockImplementation(() => {
            throw new Error("Simulated failure");
          });
        res.headersSent = true;

        await errMw(req, res, next);
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            eventId: expect.any(String),
            err: expect.any(Object),
          }),
          LOG_MESSAGES.MIDDLEWARE_ERROR_SENT,
        );
        expect(next).not.toHaveBeenCalled();
      });

      it("should handle custom sync errors with explicit status code", async () => {
        const statusCode = 418;
        const errorMsg = "I am a teapot";
        const errorDetails = "short and stout";

        /** @type {CommonError} */
        const errorWithStatus = new Error("structured err");
        errorWithStatus.statusCode = statusCode;
        errorWithStatus.error = errorMsg;
        errorWithStatus.details = errorDetails;

        const {
          req,
          res,
          next,
          middleware: errorMw,
        } = await createMiddlewareTestContext({
          webhookManager: {
            webhookData: { id: "wh_atomic" }, // Dummy data
          },
        });
        // Mock getWebhookData to throw the error
        jest
          .mocked(webhookManagerMock.getWebhookData)
          .mockImplementationOnce(() => {
            throw errorWithStatus;
          });
        Object.defineProperty(req, "method", {
          get: () => {
            throw errorWithStatus;
          },
        });
        await errorMw(req, res, next);

        expect(res.status).toHaveBeenCalledWith(statusCode);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: errorMsg, details: errorDetails }),
        );
      });
    });

    describe("Data Processing & Transformation", () => {
      it("should process buffer bodies correctly with response delays and custom headers", async () => {
        const DELAY_MS = 2;
        const CUSTOM_HEADER_KEY = "x-custom";
        const CUSTOM_HEADER_VALUE = "val";

        const {
          req,
          res,
          next,
          middleware: mwBuf,
        } = await createMiddlewareTestContext({
          options: {
            responseDelayMs: 1,
            defaultResponseHeaders: {
              [CUSTOM_HEADER_KEY]: CUSTOM_HEADER_VALUE,
            },
          },
        });
        req.body = Buffer.from("buffer-test");
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.OCTET_STREAM;

        const promise = mwBuf(req, res, next);
        await jest.advanceTimersByTimeAsync(DELAY_MS);
        await promise;

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(res.setHeader).toHaveBeenCalledWith(
          CUSTOM_HEADER_KEY,
          CUSTOM_HEADER_VALUE,
        );
      });

      it("should process unknown content-types with object bodies correctly", async () => {
        const {
          req,
          res,
          next,
          middleware: instance,
        } = await createMiddlewareTestContext();
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.IMAGE_PNG; // unknown non-text parsing
        req.body = { valid: "json-like-object" };

        await instance(req, res, next);
        expect(appEvents.emit).toHaveBeenCalledWith(
          EVENT_NAMES.LOG_RECEIVED,
          expect.objectContaining({
            body: '{"valid":"json-like-object"}',
          }),
        );
      });

      it("should catch JSON.stringify errors for fallback serialization", async () => {
        jest
          .spyOn(JSON, "stringify")
          .mockImplementationOnce(() => "{}") // passes validateWebhookRequest
          .mockImplementationOnce(() => {
            throw new Error("Simulated stringify error");
          }); // throws in prepareRequestData

        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.IMAGE_PNG; // force to branch
        req.body = { mock: "object" };

        await middleware(req, res, next);
        await jest.runAllTimersAsync();

        expect(next).not.toHaveBeenCalled();
        expect(appEvents.emit).toHaveBeenCalledWith(
          EVENT_NAMES.LOG_RECEIVED,
          expect.objectContaining({
            body: LOG_MESSAGES.BINARY_OBJECT_PLACEHOLDER,
          }),
        );
      });

      it("should simulate large payload sync offload", async () => {
        const { req, res, next, middleware, onEvent } =
          await createMiddlewareTestContext();

        const OVERFLOW_BYTES = 10;
        const totalSize = STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + OVERFLOW_BYTES;
        req.body = "A".repeat(totalSize);

        await middleware(req, res, next);
        await jest.runAllTimersAsync();

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);

        /** @type {any} */
        const event = onEvent.mock.calls[0][0];
        expect(event.body).toMatchObject({
          key: expect.any(String),
          kvsUrl: expect.any(String),
          originalSize: totalSize,
          data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
        });
        expect(event.bodyEncoding).toBeUndefined();
      });

      it(
        "should handle script execution timeouts softly",
        async () => {
          const { req, res, next, middleware } =
            await createMiddlewareTestContext({
              options: { customScript: "while(true) {}" },
            });

          await middleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
          expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({
              isTimeout: true,
              webhookId: expect.any(String),
              err: expect.any(Object),
            }),
            LOG_MESSAGES.SCRIPT_EXECUTION_TIMED_OUT(
              APP_CONSTS.SCRIPT_EXECUTION_TIMEOUT_MS,
            ),
          );
        },
        SLOW_SCRIPT_TEST_TIMEOUT_MS,
      );

      it("should handle script execution timeouts softly via message fallback", async () => {
        jest.useRealTimers();
        try {
          // Provide a script that explicitly throws an error containing the matched string without the error.code
          const { req, res, next, middleware } =
            await createMiddlewareTestContext({
              options: {
                customScript: `throw new Error("${LOG_MESSAGES.SCRIPT_EXECUTION_TIMEOUT_ERROR}");`,
              },
            });

          await middleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
          expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({
              isTimeout: true,
              webhookId: expect.any(String),
              err: expect.any(Object),
            }),
            LOG_MESSAGES.SCRIPT_EXECUTION_TIMED_OUT(
              APP_CONSTS.SCRIPT_EXECUTION_TIMEOUT_MS,
            ),
          );
        } finally {
          jest.useFakeTimers();
        }
      });

      it("should handle webhook storage key timeout", async () => {
        const timeoutMs =
          APP_CONSTS.BACKGROUND_TASK_TIMEOUT_TEST_MS + APP_CONSTS.MS_PER_SECOND;
        jest
          .mocked(forwardingServiceMock.forwardWebhook)
          .mockImplementationOnce(() =>
            assertType(
              new Promise((resolve) => setTimeout(resolve, timeoutMs)),
            ),
          );

        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { forwardUrl: TEST_URL },
          });

        const requestPromise = middleware(req, res, next);
        await jest.runAllTimersAsync();
        await requestPromise;

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should warn about timeouts with readable times in prod env", async () => {
        const prevEnv = process.env[ENV_VARS.NODE_ENV];
        try {
          process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;

          const timeoutMs =
            APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS +
            APP_CONSTS.MS_PER_SECOND;
          jest
            .mocked(forwardingServiceMock.forwardWebhook)
            .mockImplementationOnce(() =>
              assertType(
                new Promise((resolve) => setTimeout(resolve, timeoutMs)),
              ),
            );

          const { req, res, next, middleware } =
            await createMiddlewareTestContext({
              options: { forwardUrl: TEST_URL },
            });

          const requestPromise = middleware(req, res, next);
          await jest.runAllTimersAsync();
          await requestPromise;

          expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({
              timeout: expect.any(String),
              eventId: expect.any(String),
            }),
            LOG_MESSAGES.BACKGROUND_TIMEOUT,
          );
        } finally {
          process.env[ENV_VARS.NODE_ENV] = prevEnv;
        }
      });

      it("should trigger alerts if configured", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: {
              alerts: {
                slack: { webhookUrl: "https://hooks.slack.com/services/test" },
              },
            },
          });

        await middleware(req, res, next);
        await jest.runAllTimersAsync();

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });
    });

    describe("Large Payloads & Offloading Logic", () => {
      it("should fallback to truncating payload if KVS offload fails", async () => {
        apifyMock.openKeyValueStore.mockResolvedValueOnce(
          assertType({
            setValue: jest
              .fn()
              .mockRejectedValueOnce(assertType(new Error("KVS limit error"))),
          }),
        );
        const LARGE_SIZE = STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + ONE_MB;
        const {
          req,
          res,
          next,
          middleware: hugeMw,
        } = await createMiddlewareTestContext();

        const longBody = "A".repeat(LARGE_SIZE);
        req.body = longBody;

        await hugeMw(req, res, next);

        // Should successfully respond anyway
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({
            bodySize: LARGE_SIZE,
            threshold: STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD,
            kvsKey: expect.any(String),
          }),
          LOG_MESSAGES.KVS_OFFLOAD_THRESHOLD_EXCEEDED,
        );
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Object) }),
          LOG_MESSAGES.KVS_OFFLOAD_FAILED_LARGE_PAYLOAD,
        );
      });

      it("should ignore missing signature headers on stream offloading smoothly", async () => {
        signatureMock.createStreamVerifier.mockReturnValueOnce(
          assertType({ error: SIGNATURE_ERRORS.MISSING_HEADER }),
        );
        // Standard sync mock must ALSO fail for the middleware to return 401
        signatureMock.verifySignature.mockReturnValue({
          valid: false,
          provider: SIGNATURE_PROVIDERS.GITHUB,
        });

        const LARGE_SIZE = STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + ONE_MB;
        const options = {
          maxPayloadSize: APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE,
          signatureVerification: {
            provider: SIGNATURE_PROVIDERS.GITHUB,
            secret: "secret",
          },
        };
        const {
          middleware: mw,
          req,
          res,
          next,
        } = await createMiddlewareTestContext({ options });

        req.method = HTTP_METHODS.POST;
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = LARGE_SIZE.toString();
        req.isOffloaded = true;

        await mw.ingestMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      });

      it("should simulate streaming offload for huge payload", async () => {
        const LARGE_SIZE = STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + ONE_MB;
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { maxPayloadSize: APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE },
          });
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = LARGE_SIZE.toString();

        await middleware.ingestMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.isOffloaded).toBe(true);
        expect(req._body).toBe(true);
        expect(req.body).toHaveProperty("key");
        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({
            contentLength: LARGE_SIZE,
            kvsKey: expect.any(String),
          }),
          LOG_MESSAGES.KVS_OFFLOAD_START,
        );
      });

      it("should handle streaming offload failures gracefully", async () => {
        const LARGE_SIZE = STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + ONE_MB;
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { maxPayloadSize: APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE },
          });
        req.method = HTTP_METHODS.POST;
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = LARGE_SIZE.toString();
        req.pipe = () => {
          throw new Error("pipe fail");
        };
        await middleware.ingestMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        );
      });

      it("should handle streaming signature verification successfully", async () => {
        signatureMock.finalizeStreamVerification.mockReturnValueOnce(true);
        // Directly override via constsMock for maximum reliability
        const ORIGINAL_THRESHOLD =
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD;
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD =
          APP_CONSTS.BYTES_PER_KB; // 1KB

        const LARGE_SIZE =
          1 * APP_CONSTS.BYTES_PER_KB * APP_CONSTS.BYTES_PER_KB; // 1MB
        const secret = "secret";
        const payload = Buffer.alloc(LARGE_SIZE, "a");
        const sigConfig = { provider: SIGNATURE_PROVIDERS.GITHUB, secret };

        try {
          const { middleware, req, res, next, webhookManager, onEvent } =
            await createMiddlewareTestContext({
              options: { maxPayloadSize: LARGE_SIZE + APP_CONSTS.BYTES_PER_KB },
            });
          jest.mocked(webhookManager.getWebhookData).mockReturnValue({
            signatureVerification: sigConfig,
            expiresAt: new Date(
              Date.now() + APP_CONSTS.MS_PER_HOUR,
            ).toISOString(),
          });

          req.method = HTTP_METHODS.POST;
          req.params.id = "wh_stream_success";
          req.headers[HTTP_HEADERS.CONTENT_LENGTH] = LARGE_SIZE.toString();
          req.headers[HTTP_HEADERS.HUB_SIGNATURE_256] = createGitHubSignature(
            payload.toString(),
            secret,
          );

          const storeMock = await apifyMock.openKeyValueStore();
          jest.mocked(storeMock.setValue).mockImplementationOnce(async () => {
            // Emit data chunks before finishing setValue
            req.emit(STREAM_EVENTS.DATA, Buffer.from(payload));
            await flushPromises(1);
          });

          await middleware.ingestMiddleware(req, res, next);
          expect(req.ingestSignatureResult?.valid).toBe(true);

          expect(req.body).toMatchObject({
            key: expect.any(String),
            kvsUrl: expect.any(String),
            originalSize: LARGE_SIZE,
            data: STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
          });

          // Run full middleware to hit response logic
          await middleware(req, res, next);
          expect(res.status).not.toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
          expect(onEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              signatureValid: true,
              signatureProvider: SIGNATURE_PROVIDERS.GITHUB,
            }),
          );
          expect(loggerMock.info).toHaveBeenCalledWith(
            expect.objectContaining({ provider: SIGNATURE_PROVIDERS.GITHUB }),
            LOG_MESSAGES.STREAM_VERIFIER_INIT,
          );
        } finally {
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD = ORIGINAL_THRESHOLD;
        }
      });

      it("should handle streaming signature verification failure", async () => {
        signatureMock.finalizeStreamVerification.mockReturnValueOnce(false);
        const ORIGINAL_THRESHOLD =
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD;
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD =
          APP_CONSTS.BYTES_PER_KB; // 1KB

        const LARGE_SIZE =
          1 * APP_CONSTS.BYTES_PER_KB * APP_CONSTS.BYTES_PER_KB; // 1MB
        const secret = "secret";
        const payload = Buffer.alloc(LARGE_SIZE, "a");
        const sigConfig = { provider: SIGNATURE_PROVIDERS.GITHUB, secret };

        try {
          const { middleware, req, res, next, webhookManager, onEvent } =
            await createMiddlewareTestContext({
              options: { maxPayloadSize: LARGE_SIZE + APP_CONSTS.BYTES_PER_KB },
            });
          jest.mocked(webhookManager.getWebhookData).mockReturnValue({
            signatureVerification: sigConfig,
            expiresAt: new Date(
              Date.now() + APP_CONSTS.MS_PER_HOUR,
            ).toISOString(),
          });

          req.method = HTTP_METHODS.POST;
          req.params.id = "wh_stream_fail";
          req.headers[HTTP_HEADERS.CONTENT_LENGTH] = LARGE_SIZE.toString();
          req.headers[HTTP_HEADERS.HUB_SIGNATURE_256] =
            `${SIGNATURE_PREFIXES.SHA256}dummy`;

          const storeMock = await apifyMock.openKeyValueStore();
          jest.mocked(storeMock.setValue).mockImplementationOnce(async () => {
            req.emit(STREAM_EVENTS.DATA, payload);
            await flushPromises(1);
          });

          await middleware.ingestMiddleware(req, res, next);
          expect(req.ingestSignatureResult).toBeDefined();
          expect(req.ingestSignatureResult?.valid).toBe(false);

          // Run second time to hit 401 branch in main handler
          await middleware(req, res, next);
          expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
          expect(onEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              signatureValid: false,
              signatureProvider: SIGNATURE_PROVIDERS.GITHUB,
              signatureError: ERROR_LABELS.SIGNATURE_MISMATCH_STREAM,
              statusCode: HTTP_STATUS.UNAUTHORIZED,
            }),
          );
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
              details: ERROR_LABELS.SIGNATURE_MISMATCH_STREAM,
              docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
              error: ERROR_LABELS.INVALID_SIGNATURE,
              provider: SIGNATURE_PROVIDERS.GITHUB,
            }),
          );
        } finally {
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD = ORIGINAL_THRESHOLD;
        }
      });

      it("should hit implicit-else branches when stream verifier is missing hmac in offload path", async () => {
        // Not configuring signatureVerification will keep `verifier` null
        // and skip setting `req.ingestSignatureResult`, causing it to hit
        // the implicit else branches at `if (verifier && verifier.hmac)`.

        const ORIGINAL_THRESHOLD =
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD;
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD =
          APP_CONSTS.BYTES_PER_KB;

        try {
          const LARGE_SIZE =
            1 * APP_CONSTS.BYTES_PER_KB * APP_CONSTS.BYTES_PER_KB;
          const payload = Buffer.alloc(LARGE_SIZE, "a");

          const { middleware, req, res, next, webhookManager } =
            await createMiddlewareTestContext({
              options: {
                maxPayloadSize: LARGE_SIZE + APP_CONSTS.BYTES_PER_KB,
              },
            });

          jest
            .mocked(webhookManager.getWebhookData)
            .mockReturnValue(assertType({}));

          req.method = HTTP_METHODS.POST;
          req.params.id = "wh_stream_no_sig";
          req.headers[HTTP_HEADERS.CONTENT_LENGTH] = LARGE_SIZE.toString();

          const storeMock = await apifyMock.openKeyValueStore();
          jest.mocked(storeMock.setValue).mockImplementationOnce(async () => {
            req.emit(STREAM_EVENTS.DATA, payload);
            await flushPromises(1);
          });

          await middleware(req, res, next);

          // Ensure no ingestSignatureResult was attached because the verifier was invalid
          expect(req.ingestSignatureResult).toBeUndefined();
          expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK); // Flow still continues to response
        } finally {
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD = ORIGINAL_THRESHOLD;
        }
      });

      it("should handle custom script runtime error gracefully", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { customScript: 'throw new Error("runtime error");' },
          });

        await middleware(req, res, next);
        // Wait for background tasks
        await jest.runAllTimersAsync();

        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            isTimeout: false,
            webhookId: expect.any(String),
            err: expect.any(Object),
          }),
          LOG_MESSAGES.SCRIPT_EXECUTION_FAILED,
        );
      });

      it("should handle body clone failures during redaction", async () => {
        const originalClone = global.structuredClone;
        global.structuredClone = () => {
          throw new Error("Clone failed");
        };
        try {
          const { req, res, next, middleware } =
            await createMiddlewareTestContext({
              options: {
                maskSensitiveData: true,
                redactBodyPaths: ["body.test"],
              },
            });
          req.body = { test: "secret", public: "data" };

          await middleware(req, res, next);

          // Clone failure is silently caught, middleware proceeds with original body
          expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        } finally {
          global.structuredClone = originalClone;
        }
      });

      it("should fallback to JSON parsing when structuredClone is absent", async () => {
        const originalClone = global.structuredClone;
        global.structuredClone = assertType(undefined);
        try {
          const { req, res, next, middleware } =
            await createMiddlewareTestContext({
              options: {
                maskSensitiveData: true,
                redactBodyPaths: ["body.test"],
              },
            });
          req.body = { test: "secret", public: "data" };

          await middleware(req, res, next);
          // Falls back to JSON.parse(JSON.stringify()), proceeds normally
          expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        } finally {
          global.structuredClone = originalClone;
        }
      });

      it("should execute stringify fallback if loggedBody is object but not JSON/Text", async () => {
        let callCount = 0;
        const cyclic = { id: 1 };
        // @ts-expect-error - cyclic object for testing
        cyclic.loop = cyclic;

        const stringifySpy = jest
          .spyOn(JSON, "stringify")
          .mockImplementation((value) => {
            if (value === cyclic) {
              callCount++;
              if (callCount === 1) return '{"mock": true}'; // Validation pass
              throw new TypeError("simulated cyclic error");
            }
            return JSON.stringify(value);
          });

        const { req, res, next, middleware } =
          await createMiddlewareTestContext();

        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;
        req.body = cyclic;

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);

        stringifySpy.mockRestore();
      });

      it("should correctly handle omitted max payload size via default resolution", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.body = { test: "data" };
        await middleware(req, res, next); // Covers max payload omission nullish coalescing

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should hit timeout branch directly via timeout mock manipulation", async () => {
        // Simulate timeout by overwriting global timeout just for this test
        jest.spyOn(global, "setTimeout").mockImplementation(
          /**
           * @param {(...args: any[]) => void} cb
           * @returns {NodeJS.Timeout}
           */
          (cb) => {
            cb(); // Execute timeout callback instantly
            return assertType({});
          },
        );
        // Simulate general aborted error in background tasks
        apifyMock.pushData.mockRejectedValueOnce(
          new Error(NODE_ERROR_CODES.ABORT_ERROR),
        );

        const { req, res, next, middleware } =
          await createMiddlewareTestContext();

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        jest.spyOn(global, "setTimeout").mockRestore();
      });

      it("should process explicit string responses safely", async () => {
        const defaultResponseBody = "Explicit Plain Response";
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { defaultResponseBody },
          });
        await middleware(req, res, next);

        expect(res.send).toHaveBeenCalledWith(defaultResponseBody);
      });

      it("should use explicit default custom JSON when sending error response", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { defaultResponseCode: HTTP_STATUS.BAD_REQUEST },
          });
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.any(String),
            webhookId: expect.any(String),
          }),
        );
        expect(res.send).not.toHaveBeenCalled();
      });

      it("should trigger JSON formulation if responseBody equals DEFAULT_SUCCESS_BODY and status is an error", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: {
              defaultResponseCode: HTTP_STATUS.BAD_REQUEST,
              defaultResponseBody: HTTP_CONSTS.DEFAULT_SUCCESS_BODY,
            },
          });
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.any(String),
            webhookId: expect.any(String),
          }),
        );
        expect(res.send).not.toHaveBeenCalled();
      });
    });

    describe("Validation & Security Branch Coverage", () => {
      it("should block requests failing IP check in validateWebhookRequest directly", async () => {
        // 127.0.0.1 is not in the allowed range
        const originalIp = "127.0.0.1";
        const webhookId = "wh_atomic";
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            options: { allowedIps: ["10.0.0.1/32"] },
          });
        req.params.id = webhookId;
        Object.defineProperty(req, "ip", {
          value: originalIp,
          writable: false,
          configurable: false,
          enumerable: true,
        });
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: ERROR_MESSAGES.FORBIDDEN_IP,
            ip: originalIp,
            id: webhookId,
            docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
            received: undefined,
          }),
        );
      });

      it("should reject large payload in main middleware directly via validateWebhookRequest", async () => {
        const webhookId = "wh_large";
        const SMALL_PAYLOAD_LIMIT = 5;
        const CONTENT_LENGTH = 18;
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { maxPayloadSize: SMALL_PAYLOAD_LIMIT },
          });
        req.params.id = webhookId;
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = CONTENT_LENGTH.toString();
        req.body = "LARGE BODY AAAAAAA"; // 18 chars

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.PAYLOAD_TOO_LARGE);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: ERROR_MESSAGES.PAYLOAD_TOO_LARGE(SMALL_PAYLOAD_LIMIT),
            received: CONTENT_LENGTH,
            id: webhookId,
            docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
          }),
        );
      });

      it("should catch background platform errors", async () => {
        forwardingServiceMock.forwardWebhook.mockRejectedValueOnce(
          new Error("Memory limit exceeded"),
        );
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { forwardUrl: TEST_URL },
          });

        await middleware(req, res, next);
        await jest.runAllTimersAsync();

        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            webhookId: expect.any(String),
            isPlatformError: true,
            err: expect.any(Object),
          }),
          LOG_MESSAGES.PLATFORM_LIMIT_ERROR,
        );
      });

      it("should catch and log unhandled background promise errors", async () => {
        alertingMock.triggerAlertIfNeeded.mockRejectedValueOnce(
          assertType(new Error("Alert service down")),
        );
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: {
              alerts: {
                slack: { webhookUrl: "https://hooks.slack.com/test" },
              },
            },
          });

        await middleware(req, res, next);
        await jest.runAllTimersAsync();

        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            err: expect.any(Object),
            eventId: expect.any(String),
          }),
          LOG_MESSAGES.BACKGROUND_TASKS_FAILED,
        );
      });

      it("should log error when forwarding service throws general error", async () => {
        forwardingServiceMock.forwardWebhook.mockRejectedValueOnce(
          new Error("Network error"),
        );
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { forwardUrl: TEST_URL },
          });
        await middleware(req, res, next);
        await jest.runAllTimersAsync();
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            webhookId: expect.any(String),
            isPlatformError: false,
            err: expect.any(Object),
          }),
          LOG_MESSAGES.BACKGROUND_ERROR,
        );
      });

      // --- Branch: offloaded request path with missing content-type ---
      it("should handle offloaded requests with missing content-type header", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.isOffloaded = true;
        delete req.headers[HTTP_HEADERS.CONTENT_TYPE];
        req.body = "stream-data";
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: offloaded request with maskSensitiveData ---
      it("should mask headers on offloaded requests when maskSensitiveData is true", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { maskSensitiveData: true },
          });
        req.isOffloaded = true;
        req.headers[HTTP_HEADERS.AUTHORIZATION] =
          `${AUTH_CONSTS.BEARER_PREFIX}secret-token`;
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: Object body in TEXT content-type ---
      it("should convert object body to string when content-type is TEXT", async () => {
        const { req, res, next, middleware, onEvent } =
          await createMiddlewareTestContext();
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.TEXT;
        const body = { key: "value" };
        req.body = body;
        const p = middleware(req, res, next);
        await jest.runAllTimersAsync();
        await p;

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(onEvent).toHaveBeenCalled();

        /** @type {any} */
        const event = onEvent.mock.calls[0][0];
        expect(event.body).toBe(JSON.stringify(body));
      });

      // --- Branch: Buffer body in JSON content-type ---
      it("should convert buffer body to string when content-type is JSON", async () => {
        const { req, res, next, middleware, onEvent } =
          await createMiddlewareTestContext();
        const stringifiedBody = JSON.stringify({ key: "value" });
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;
        req.body = Buffer.from(stringifiedBody);
        const p = middleware(req, res, next);
        await jest.runAllTimersAsync();
        await p;

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(onEvent).toHaveBeenCalled();

        /** @type {any} */
        const event = onEvent.mock.calls[0][0];
        expect(event.body).toBe(stringifiedBody);
      });

      // --- Branch: null/undefined body and body sizing ---
      it("should handle null body gracefully", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.body = null;
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: null/undefined body and body sizing ---
      it("should handle request missing query payload format", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.headers[HTTP_HEADERS.X_APIFY_ID] = "dummy";
        req.query = assertType(null);
        await middleware(req, res, next);
        expect(res.status).not.toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: string body for sizing ---
      it("should calculate body size from string body", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.body = "plain-text-body";
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.TEXT;
        delete req.headers[HTTP_HEADERS.CONTENT_LENGTH];
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: Buffer body sizing ---
      it("should calculate body size from buffer body", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.body = Buffer.from("binary-data");
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.OCTET_STREAM;
        delete req.headers[HTTP_HEADERS.CONTENT_LENGTH];
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: array content-length header ---
      it("should handle array content-length header", async () => {
        const { req, res, next, middleware } =
          await createMiddlewareTestContext();
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = assertType(["50", "50"]);
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: no onEvent callback ---
      it("should handle missing onEvent callback gracefully", async () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const next = createMockNextFunction();

        // The context helper always provides an onEvent mock, so to test 'null' we must manually re-instantiate or tweak.
        // Easiest is to manually instantiate for this specific edge case.
        const mwNone = new LoggerMiddleware(
          webhookManagerMock,
          {},
          assertType(null),
          forwardingServiceMock,
        );
        await mwNone.middleware(req, res, next);
        await jest.runAllTimersAsync();
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      // --- Branch: signal pre-aborted in executeBackgroundTasks ---
      it("should skip background tasks when signal is pre-aborted", async () => {
        const OriginalAbortController = global.AbortController;
        const controllerSpy = jest
          .spyOn(global, "AbortController")
          .mockImplementation(() => {
            const ctrl = new OriginalAbortController();
            ctrl.abort();
            return ctrl;
          });

        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: { forwardUrl: TEST_URL },
          });
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(forwardingServiceMock.forwardWebhook).not.toHaveBeenCalled();

        controllerSpy.mockRestore();
      });

      // --- Branch: object response body ---
      it(
        "should send object response body as JSON",
        async () => {
          jest.useRealTimers();
          try {
            const responseObj = { success: true, data: { id: 1 } };
            const { req, res, next, middleware } =
              await createMiddlewareTestContext({
                options: {
                  customScript: `event.responseBody = ${JSON.stringify(responseObj)};`,
                },
              });
            await middleware(req, res, next);
            expect(res.json).toHaveBeenCalledWith(responseObj);
          } finally {
            jest.useFakeTimers();
          }
        },
        SLOW_SCRIPT_TEST_TIMEOUT_MS,
      );

      // --- Branch: request with no IP and socket fallback ---
      it("should fallback to socket.remoteAddress when req.ip is absent", async () => {
        const { req, res, next, middleware, onEvent } =
          await createMiddlewareTestContext();
        Object.defineProperty(req, "ip", {
          value: undefined,
          writable: false,
          configurable: false,
          enumerable: true,
        });
        // eslint-disable-next-line sonarjs/no-hardcoded-ip
        const remoteAddress = "2.2.2.2";
        req.socket = assertType({ remoteAddress });
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ remoteIp: remoteAddress }),
        );
      });

      // --- Branch: rawBody used for signature verification ---
      it("should use rawBody for signature verification when available and lowercase headers", async () => {
        const secret = "secret";
        const customHeader = "X-CaMeL-CaSe-HeAdEr";
        const customValue = "Value-here";
        const { req, res, next, middleware } =
          await createMiddlewareTestContext({
            options: {
              signatureVerification: {
                provider: SIGNATURE_PROVIDERS.GITHUB,
                secret,
              },
            },
          });
        const payload = Buffer.from("raw-payload");
        req.rawBody = assertType(payload);
        const sig = createGitHubSignature(payload.toString(), secret);
        req.headers[HTTP_HEADERS.HUB_SIGNATURE_256] = sig;
        req.headers[customHeader] = customValue;

        await middleware(req, res, next);

        expect(signatureMock.verifySignature).toHaveBeenCalledWith(
          expect.anything(),
          payload,
          expect.objectContaining({
            [HTTP_HEADERS.HUB_SIGNATURE_256]: sig,
            [customHeader.toLowerCase()]: customValue,
          }),
        );
      });

      // --- Branch: request with missing originalUrl ---
      it("should fallback to req.url when originalUrl is missing", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        // @ts-expect-error - deleting originalUrl (mandatory property) for testing purposes
        delete req.originalUrl;
        const fallbackUrl = "/fallback-url";
        req.url = fallbackUrl;
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ requestUrl: fallbackUrl }),
        );
      });

      // --- Branch: normal request with originalUrl ---
      it("should handle normal request with originalUrl", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";

        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ requestUrl: expect.any(String) }),
        );

        onEvent.mockClear();
        const originalUrl = "/original-url";
        req.originalUrl = originalUrl;
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ requestUrl: originalUrl }),
        );
      });

      // --- Branch: request missing userAgent header ---
      it("should handle request without user-agent header", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        delete req.headers[HTTP_HEADERS.USER_AGENT];
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ userAgent: undefined }),
        );
      });

      // --- Branch: request with userAgent header ---
      it("should handle request with user-agent header", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        const userAgent = "test-agent";
        req.headers[HTTP_HEADERS.USER_AGENT] = userAgent;
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ userAgent }),
        );
      });

      // --- Branch: request with size limit exceeded ---
      it("should calculate size of request body from content-length header and pass it to onEvent", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        const size = 100;
        req.params.id = "wh_atomic";
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = size.toString();
        req.body = "a".repeat(size + 1);
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ size }), // header size is used even if body is larger
        );

        onEvent.mockClear();
        delete req.headers[HTTP_HEADERS.CONTENT_LENGTH];
        req.body = Buffer.from("a".repeat(size + 1));
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ size: size + 1 }), // if no content-length header, use body size
        );
      });

      // --- Branch: non-sensitive content type with stringify fallback for object ---
      it("should stringify object body for binary content-type without buffer", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.OCTET_STREAM;
        req.body = { raw: "data" };
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            body: JSON.stringify(req.body),
          }),
        );
      });

      it("should successfully pass middleware for circular object in request body due to default size", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        const circular = { a: 1 };
        // @ts-expect-error - circular reference for testing purposes
        circular.self = circular;
        req.body = circular;
        await middleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(res.send).toHaveBeenCalled();
      });

      // --- Branch: non-maskSensitiveData path ---
      it("should not mask headers when maskSensitiveData is false", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext({
            options: { maskSensitiveData: false },
          });
        req.params.id = "wh_atomic";
        req.headers[HTTP_HEADERS.AUTHORIZATION] =
          `${AUTH_CONSTS.BEARER_PREFIX}visible-token`;
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            headers: expect.objectContaining({
              [HTTP_HEADERS.AUTHORIZATION]:
                req.headers[HTTP_HEADERS.AUTHORIZATION],
            }),
          }),
        );
      });

      // --- Branch: event.responseHeaders merging with defaults ---
      it(
        "should merge event responseHeaders over default headers",
        async () => {
          const customHeader = "X-Custom";
          const defaultValue = "Default";
          const customHeaderValue = "Override";
          const { middleware, req, res, next } =
            await createMiddlewareTestContext({
              options: {
                defaultResponseHeaders: {
                  [customHeader]: defaultValue,
                },
                customScript: `event.responseHeaders = { '${customHeader}': '${customHeaderValue}' };`,
              },
            });
          req.params.id = "wh_atomic";
          await middleware(req, res, next);
          expect(res.setHeader).toHaveBeenCalledWith(
            customHeader,
            customHeaderValue,
          );
        },
        SLOW_SCRIPT_TEST_TIMEOUT_MS,
      );

      // --- Branch: schema provided per-webhook via getWebhookData ---
      it("should handle schema as object in validateWebhookRequest", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              jsonSchema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          });
        req.params.id = "wh_atomic";
        req.body = { wrongField: 123 };
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      });

      it("should handle jsonSchema as string during runtime update", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        middleware.updateOptions({
          jsonSchema: JSON.stringify({ type: "object", required: ["test"] }),
        });
        req.body = { other: 1 };
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      });

      it("should return UNAUTHORIZED when auth validation fails without explicit statusCode", async () => {
        jest.spyOn(authMock, "validateAuth").mockReturnValueOnce(
          assertType({
            isValid: false,
            error: "Missing code",
          }),
        );

        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { authKey: "secret" },
          });
        req.params.id = "wh_no_code";

        await middleware(req, res, next);
        // #validateWebhookRequest always sets statusCode: UNAUTHORIZED for auth failures
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      });

      it("should return false during per-request schema validation if compilation fails", async () => {
        const webhookId = "wh_atomic";
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { jsonSchema: { type: "object" } },
          });
        req.params.id = webhookId;

        const AjvClass = (await import("ajv")).default;
        const ajvSpy = jest
          // @ts-expect-error - access prototype for mocking
          .spyOn(AjvClass.prototype || AjvClass, "compile")
          .mockImplementationOnce(() => {
            throw new Error("Ajv fail");
          });

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: "No errors", id: webhookId }),
        );
        ajvSpy.mockRestore();
      });

      it("should fallback to OCTET_STREAM when offloaded content-type is missing", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        /** @type {CustomRequest} */ (req).isOffloaded = true;
        delete req.headers[HTTP_HEADERS.CONTENT_TYPE];

        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: MIME_TYPES.OCTET_STREAM,
          }),
        );
      });

      it("should default to OK status when defaultResponseCode is undefined", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { defaultResponseCode: undefined },
          });
        req.params.id = "wh_atomic";
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should prioritize req.forcedStatus over defaultResponseCode", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext({
            options: { defaultResponseCode: HTTP_STATUS.OK },
          });
        req.params.id = "wh_atomic";
        req.forcedStatus = HTTP_STATUS.ACCEPTED; // 202
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.ACCEPTED);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: HTTP_STATUS.ACCEPTED }),
        );
      });

      it("should propagate req.requestId to event.requestId", async () => {
        const requestId = "trace-abc-123";
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        req.requestId = requestId;
        await middleware(req, res, next);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ requestId }),
        );
      });

      it("should use JSON.stringify for signature verification when body is an object", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              signatureVerification: {
                provider: SIGNATURE_PROVIDERS.STRIPE,
                secret: "abc",
              },
            },
          });
        req.params.id = "wh_atomic";
        req.body = { foo: "bar" };
        delete (/** @type {CustomRequest} */ (req).rawBody);

        await middleware(req, res, next);
        expect(signatureMock.verifySignature).toHaveBeenCalledWith(
          expect.anything(),
          JSON.stringify(req.body),
          expect.anything(),
        );
      });

      it("should use string body directly for signature verification", async () => {
        const rawBody = "plain string";
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              signatureVerification: {
                provider: SIGNATURE_PROVIDERS.STRIPE,
                secret: "abc",
              },
            },
          });
        req.params.id = "wh_atomic";
        req.body = rawBody;
        delete (/** @type {CustomRequest} */ (req).rawBody);

        await middleware(req, res, next);
        expect(signatureMock.verifySignature).toHaveBeenCalledWith(
          expect.anything(),
          rawBody,
          expect.anything(),
        );
      });

      it("should not log error if signal is aborted during background task exception", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";

        // Mock pushData to throw after some time
        let rejectPush = () => {};
        const pushPromise = new Promise((_, reject) => {
          rejectPush = () => reject(new Error("Background fail"));
        });
        jest.mocked(apifyMock.pushData).mockReturnValue(pushPromise);

        const p = middleware(req, res, next);
        // Wait for response to be sent and background tasks to start
        await flushPromises(1);

        // Trigger timeout which aborts the signal
        const timeoutRaw = APP_CONSTS.BACKGROUND_TASK_TIMEOUT_TEST_MS;
        const timeout = 10;
        jest.advanceTimersByTime(timeoutRaw + timeout);
        await jest.runAllTimersAsync();

        // Now reject the push - should be ignored because signal is aborted
        rejectPush();
        await p;

        expect(loggerMock.error).not.toHaveBeenCalled();
      });

      it("should log platform limits warning on platform errors", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        req.params.id = "wh_atomic";
        jest
          .mocked(apifyMock.pushData)
          .mockRejectedValueOnce(new Error("Rate limit exceeded"));

        await middleware(req, res, next);
        await jest.runAllTimersAsync();
        expect(loggerMock.warn).toHaveBeenCalledWith(
          LOG_MESSAGES.CHECK_PLATFORM_LIMITS,
        );
      });

      it("should format sub-second background task timeouts as ms", async () => {
        const SUB_SECOND_TIMEOUT = 500;
        const TIMEOUT_OFFSET = 10;
        const originalEnv = process.env[ENV_VARS.NODE_ENV];

        try {
          process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
          // Ensure constants are mutated BEFORE creating context
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS =
            SUB_SECOND_TIMEOUT;

          const { middleware, req, res, next } =
            await createMiddlewareTestContext();
          req.params.id = "wh_atomic";

          // Hang pushData
          const pushPromise = new Promise(() => {});
          jest.mocked(apifyMock.pushData).mockReturnValue(pushPromise);

          const p = middleware(req, res, next);
          await flushPromises(1); // Allow synchronous checks to pass

          jest.advanceTimersByTime(SUB_SECOND_TIMEOUT + TIMEOUT_OFFSET);
          await p;

          expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({
              timeout: `${SUB_SECOND_TIMEOUT}ms`,
              eventId: expect.any(String),
            }),
            LOG_MESSAGES.BACKGROUND_TIMEOUT,
          );
        } finally {
          process.env[ENV_VARS.NODE_ENV] = originalEnv;
        }
      });

      it("should format timeout message as seconds in production environment", async () => {
        const PROD_TIMEOUT_MS = 5000;
        const EXPECTED_SECONDS = PROD_TIMEOUT_MS / APP_CONSTS.MS_PER_SECOND;
        const timeoutOffset = 10;
        const originalEnv = process.env[ENV_VARS.NODE_ENV];

        try {
          process.env[ENV_VARS.NODE_ENV] = ENV_VALUES.PRODUCTION;
          // Explicitly set a ≥1s timeout to exercise the "Xs" format branch
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS =
            PROD_TIMEOUT_MS;

          const { middleware, req, res, next } =
            await createMiddlewareTestContext();
          req.params.id = "wh_prod";

          // Hang pushData
          const pushPromise = new Promise(() => {});
          jest.mocked(apifyMock.pushData).mockReturnValue(pushPromise);

          const promise = middleware(req, res, next);
          await flushPromises(1);

          jest.advanceTimersByTime(PROD_TIMEOUT_MS + timeoutOffset);
          await jest.runAllTimersAsync();
          await promise;

          expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({
              timeout: `${EXPECTED_SECONDS}s`,
              eventId: expect.any(String),
            }),
            LOG_MESSAGES.BACKGROUND_TIMEOUT,
          );
        } finally {
          process.env[ENV_VARS.NODE_ENV] = originalEnv;
        }
      });

      it("should handle completely missing IP info by defaulting to empty string in SSRF check", async () => {
        // eslint-disable-next-line sonarjs/no-hardcoded-ip
        const allowedIp = "1.1.1.1";
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { allowedIps: [allowedIp] },
          });
        req.params.id = "wh_atomic";
        Object.defineProperty(req, "ip", { value: undefined });
        req.socket = assertType({ remoteAddress: undefined });

        await middleware(req, res, next);
        expect(ssrfMock.checkIpInRanges).toHaveBeenCalledWith("", [allowedIp]);
      });

      it("should use DEFAULT_PAYLOAD_LIMIT if maxPayloadSize option is null", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { maxPayloadSize: assertType(null) },
          });
        req.params.id = "wh_atomic";
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = String(
          APP_CONSTS.DEFAULT_PAYLOAD_LIMIT + 1,
        );

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.PAYLOAD_TOO_LARGE);
      });

      it("should handle background task errors with no message", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        jest.mocked(apifyMock.pushData).mockRejectedValueOnce(assertType({})); // No message property
        await middleware(req, res, next);
        await jest.runAllTimersAsync();
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            err: expect.any(Object),
            webhookId: expect.any(String),
            isPlatformError: expect.any(Boolean),
          }),
          LOG_MESSAGES.BACKGROUND_ERROR,
        );
      });

      it("should handle sync signature verification failure path and assert event fields", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext({
            options: {
              signatureVerification: {
                provider: SIGNATURE_PROVIDERS.GITHUB,
                secret: "foo",
              },
            },
          });
        req.params.id = "wh_atomic";
        jest.mocked(signatureMock.verifySignature).mockReturnValueOnce(
          assertType({
            valid: false,
            provider: SIGNATURE_PROVIDERS.GITHUB,
            error: SIGNATURE_ERRORS.MISMATCH,
          }),
        );
        const p = middleware(req, res, next);
        await jest.runAllTimersAsync();
        await p;
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: ERROR_LABELS.INVALID_SIGNATURE,
            details: SIGNATURE_ERRORS.MISMATCH,
            docs: APP_CONSTS.APIFY_HOMEPAGE_URL,
          }),
        );
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            signatureValid: false,
            signatureProvider: SIGNATURE_PROVIDERS.GITHUB,
            signatureError: SIGNATURE_ERRORS.MISMATCH,
            statusCode: HTTP_STATUS.UNAUTHORIZED,
          }),
        );
      });

      it("should handle sync signature verification success path and assert event fields", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext({
            options: {
              signatureVerification: {
                provider: SIGNATURE_PROVIDERS.GITHUB,
                secret: "foo",
              },
            },
          });
        req.params.id = "wh_atomic";
        jest.mocked(signatureMock.verifySignature).mockReturnValueOnce({
          valid: true,
          provider: SIGNATURE_PROVIDERS.GITHUB,
        });
        const p = middleware(req, res, next);
        await jest.runAllTimersAsync();
        await p;
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            signatureValid: true,
            signatureProvider: SIGNATURE_PROVIDERS.GITHUB,
          }),
        );
      });

      it("should silently skip verification if signature config has provider but no secret", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext({
            options: {
              signatureVerification: {
                provider: SIGNATURE_PROVIDERS.GITHUB,
                secret: "",
              },
            },
          });
        req.params.id = "wh_atomic";
        await middleware(req, res, next);
        expect(res.status).not.toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
        /** @type {WebhookEvent} */
        const emittedEvent = assertType(jest.mocked(onEvent).mock.calls[0][0]);
        expect(emittedEvent.signatureValid).toBeUndefined();
      });

      it("should silently skip verification if signature config has secret but no provider", async () => {
        const { middleware, req, res, next, onEvent } =
          await createMiddlewareTestContext({
            options: {
              signatureVerification: {
                provider: "",
                secret: "foo",
              },
            },
          });
        req.params.id = "wh_atomic";
        await middleware(req, res, next);
        expect(res.status).not.toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
        /** @type {WebhookEvent} */
        const emittedEvent = assertType(jest.mocked(onEvent).mock.calls[0][0]);
        expect(emittedEvent.signatureValid).toBeUndefined();
      });

      it("should handle streaming signature verification failure in main middleware", async () => {
        const sigConfig = {
          provider: SIGNATURE_PROVIDERS.GITHUB,
          secret: "foo",
        };
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            webhookManager: {
              webhookData: { signatureVerification: sigConfig },
            },
          });
        req.params.id = "wh_atomic";
        req.ingestSignatureResult = {
          valid: false,
          error: SIGNATURE_ERRORS.MISMATCH,
          provider: SIGNATURE_PROVIDERS.GITHUB,
        };
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      });

      it(
        "should trigger transformation script execution error branch",
        async () => {
          const { middleware, req, res, next } =
            await createMiddlewareTestContext({
              options: { customScript: 'throw new Error("Script Fail")' },
            });
          req.params.id = "wh_atomic";
          await middleware(req, res, next);
          expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({
              isTimeout: false,
              webhookId: expect.any(String),
              err: expect.any(Object),
            }),
            LOG_MESSAGES.SCRIPT_EXECUTION_FAILED,
          );
        },
        SLOW_SCRIPT_TEST_TIMEOUT_MS,
      );

      it("should handle circular references in sync signature verification fallback", async () => {
        const sigConfig = {
          provider: SIGNATURE_PROVIDERS.GITHUB,
          secret: "foo",
        };
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            webhookManager: {
              webhookData: { signatureVerification: sigConfig },
            },
          });

        req.method = HTTP_METHODS.POST;
        req.params.id = "wh_circular";
        req.body = {};
        Object.defineProperty(req, "rawBody", {
          value: undefined,
          configurable: true,
        });
        jest.spyOn(JSON, "stringify").mockImplementation(() => {
          throw new Error("Circular dependency");
        });

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        // Log NOT called because headersSent is false
        expect(loggerMock.error).not.toHaveBeenCalled();
      });

      it("should log error when error occurs and headers are already sent", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        req.params.id = "wh_err_headers";
        Object.defineProperty(res, "headersSent", {
          value: true,
          configurable: true,
        });

        // Prevent JSON stringification from swallowing error (we want error inside the main logic)
        // `contentLength` calculation happens before stringification.
        // Let's force an error in `this.#resolveOptions` to test the outer catch bracket.
        Object.defineProperty(req.params, "id", {
          get: () => {
            throw new Error("Immediate error");
          },
        });
        req.method = HTTP_METHODS.POST;
        req.body = { foo: "bar" };

        await middleware(req, res, next);

        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({
            eventId: expect.any(String),
            err: expect.any(Object),
          }),
          LOG_MESSAGES.MIDDLEWARE_ERROR_SENT,
        );
      });

      it("should trigger response delay branch", async () => {
        const responseDelayMs = 50;
        jest
          .mocked(configMock.getSafeResponseDelay)
          .mockReturnValueOnce(responseDelayMs);

        const { middleware, req, res, next, webhookManager, onEvent } =
          await createMiddlewareTestContext({
            options: { responseDelayMs },
          });
        jest.mocked(webhookManager.getWebhookData).mockReturnValue({
          responseDelayMs,
          expiresAt: new Date(
            Date.now() + APP_CONSTS.MS_PER_HOUR,
          ).toISOString(),
        });
        req.params.id = "wh_delay";
        // Ensure it passes all checks before orchestration
        req.method = HTTP_METHODS.GET;
        req.query = { test: "123", page: "2" };

        const mwPromise = middleware(req, res, next);
        // Flush microtasks to reach the await setTimeout inside middleware
        await flushPromises(1 + 1);

        await jest.advanceTimersByTimeAsync(responseDelayMs);
        await mwPromise;

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            processingTime: expect.any(Number),
            query: expect.objectContaining({ test: "123", page: "2" }),
          }),
        );
        /** @type {WebhookEvent} */
        const emittedEvent = assertType(jest.mocked(onEvent).mock.calls[0][0]);
        expect(emittedEvent.processingTime).toBeGreaterThanOrEqual(
          responseDelayMs,
        );
      });

      it("should trigger stream verifier warning when init fails", async () => {
        const error = "Failed to init";
        const sigConfig = {
          provider: SIGNATURE_PROVIDERS.GITHUB,
          secret: "foo",
        };
        const ONE_KB = APP_CONSTS.BYTES_PER_KB;
        const LARGE_SIZE = STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + ONE_KB;
        const { middleware, req, res, next, webhookManager } =
          await createMiddlewareTestContext({
            options: { maxPayloadSize: LARGE_SIZE + ONE_KB },
          });
        jest.mocked(webhookManager.getWebhookData).mockReturnValue({
          signatureVerification: sigConfig,
          expiresAt: new Date(
            Date.now() + APP_CONSTS.MS_PER_HOUR,
          ).toISOString(),
        });

        req.method = HTTP_METHODS.POST;
        req.params.id = "wh_stream_fail_init";
        req.headers[HTTP_HEADERS.CONTENT_LENGTH] = String(LARGE_SIZE);

        jest
          .mocked(signatureMock.createStreamVerifier)
          .mockReturnValueOnce(assertType({ error }));

        await middleware.ingestMiddleware(req, res, next);
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ error }),
          LOG_MESSAGES.STREAM_VERIFIER_FAILED,
        );
      });

      it("should handle aborted signal in background tasks via timeout", async () => {
        const timeoutOffset = 200;
        const PROD_TIMEOUT_MS = 10000;
        const timeout = Math.round(PROD_TIMEOUT_MS / APP_CONSTS.MS_PER_SECOND);
        const ORIGINAL_TIMEOUT =
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS;

        try {
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS =
            PROD_TIMEOUT_MS;

          const { middleware, req, res, next } =
            await createMiddlewareTestContext({
              options: { forwardUrl: TEST_URL },
              nodeEnv: ENV_VALUES.PRODUCTION,
            });
          req.params.id = "wh_abort";
          req.method = HTTP_METHODS.POST;
          req.body = { foo: "bar" };

          // Hang pushData to ensure the timer isn't cleared early
          const pushPromise = new Promise(() => {});
          jest.mocked(apifyMock.pushData).mockReturnValue(pushPromise);

          const mwPromise = middleware(req, res, next);
          await flushPromises(1); // hit background tasks

          // Advance timers beyond the 10s threshold
          jest.advanceTimersByTime(PROD_TIMEOUT_MS + timeoutOffset);

          // Deterministically wait for the timeout signal and subsequent logging
          await jest.runAllTimersAsync();

          expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({
              timeout: `${timeout}s`,
              eventId: expect.any(String),
            }),
            LOG_MESSAGES.BACKGROUND_TIMEOUT,
          );

          await mwPromise;

          expect(forwardingServiceMock.forwardWebhook).not.toHaveBeenCalled();
        } finally {
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS =
            ORIGINAL_TIMEOUT;
        }
      });

      it("should cover null responseHeaders and skip background tasks via custom script", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              customScript:
                "event.responseHeaders = null; event.webhookId = '';",
              forwardUrl: TEST_URL,
            },
          });
        req.params.id = "wh_script_null";
        req.method = HTTP_METHODS.POST;
        req.body = { foo: "bar" };

        await middleware(req, res, next);
        await flushPromises(1); // background tasks

        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
        expect(apifyMock.pushData).not.toHaveBeenCalled();
        expect(forwardingServiceMock.forwardWebhook).not.toHaveBeenCalled();
      });

      it("should skip pushData when customScript unsets responseHeaders to null and webhookId to empty string", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              customScript:
                "event.responseHeaders = null; event.webhookId = '';",
            },
          });

        req.method = HTTP_METHODS.POST;
        req.params.id = "wh_id_customscript";
        req.body = { test: true };

        // Make pushData track calls without doing anything
        // jest.mocked(apifyMock.pushData).mockClear();
        // already achieved via useMockCleanup()'s beforeEach
        // which already calls jest.clearAllMocks()

        await middleware(req, res, next);

        // Allow execution of any remaining microtasks
        await jest.runAllTimersAsync();

        // No Actor.pushData should be called because we erased webhookId inside the customscript
        expect(apifyMock.pushData).not.toHaveBeenCalled();
      });

      it("should hit implicit-else branch by providing customScript that unsets webhookId but retains headers", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              customScript: "event.webhookId = null;",
            },
          });

        req.method = HTTP_METHODS.POST;
        req.params.id = "wh_implicit";
        req.body = { test: true };

        // already achieved via useMockCleanup()'s beforeEach
        // which already calls jest.clearAllMocks()
        await middleware(req, res, next);
        await jest.runAllTimersAsync();

        expect(apifyMock.pushData).not.toHaveBeenCalled();
      });

      it("should handle signal abortion in background task catch block", async () => {
        const timeoutOffset = 50;
        const timeoutOffsetLow = 10;
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        req.params.id = "wh_catch_abort";
        req.method = HTTP_METHODS.POST;

        // Mock pushData to reject AFTER the 100ms background timeout triggers
        // Using mockImplementation instead of mockReturnValue for fresher state
        jest.mocked(apifyMock.pushData).mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              setTimeout(
                () => reject(new Error("Late failure")),
                APP_CONSTS.BACKGROUND_TASK_TIMEOUT_TEST_MS + timeoutOffset,
              );
            }),
        );

        const mwPromise = middleware(req, res, next);

        // Advance to trigger internal middleware timeout (100ms) -> abort()
        jest.advanceTimersByTime(
          APP_CONSTS.BACKGROUND_TASK_TIMEOUT_TEST_MS + timeoutOffsetLow,
        );

        // Run the 150ms timer for pushData rejection
        await jest.runAllTimersAsync();
        await mwPromise;

        // Crucial: Verify that because it was aborted, no standard error log was emitted
        expect(loggerMock.error).not.toHaveBeenCalledWith(
          expect.anything(),
          LOG_MESSAGES.BACKGROUND_TASKS_FAILED,
        );
      });

      it("should hit the outer background catch block branch via alerts", async () => {
        const PROD_TIMEOUT_MS = 10000;
        const ALERT_FAIL_DELAY_MS = 500;
        const ABORT_WAIT_MS = 10;

        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              alerts: { slack: { webhookUrl: "https://slack.com" } },
            },
            nodeEnv: ENV_VALUES.PRODUCTION,
          });

        // Force production timeout to 10s for determinism via constsMock
        const ORIGINAL_TIMEOUT =
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS;

        try {
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS =
            PROD_TIMEOUT_MS;

          req.params.id = "wh_outer_catch_abort";
          req.method = HTTP_METHODS.POST;

          // Mock triggerAlertIfNeeded to throw AFTER abort (which is 10s in PROD)
          alertingMock.triggerAlertIfNeeded.mockImplementationOnce(() =>
            assertType(
              new Promise((_, reject) => {
                setTimeout(
                  () => reject(new Error("Alert failure")),
                  PROD_TIMEOUT_MS + ALERT_FAIL_DELAY_MS,
                );
              }),
            ),
          );

          const mwPromise = middleware(req, res, next);
          // Advance timers to trigger the 10s PRODUCTION timeout first.
          jest.advanceTimersByTime(PROD_TIMEOUT_MS + ABORT_WAIT_MS);
          await jest.runAllTimersAsync();
          await mwPromise;

          // Verify no failure log due to abort
          expect(loggerMock.error).not.toHaveBeenCalledWith(
            expect.anything(),
            LOG_MESSAGES.BACKGROUND_TASKS_FAILED,
          );
        } finally {
          constsMock.APP_CONSTS.BACKGROUND_TASK_TIMEOUT_PROD_MS =
            ORIGINAL_TIMEOUT;
        }
      });

      it("should handle redaction with no matching paths branch", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { redactBodyPaths: ["notbody.foo"] },
          });
        req.params.id = "wh_redact_false";
        req.method = HTTP_METHODS.POST;
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;
        req.body = { foo: "bar" };

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should convert non-string non-object body to string for content-to-save", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext();
        req.params.id = "wh_string_conv";
        req.method = HTTP_METHODS.POST;
        req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.OCTET_STREAM;
        req.body = 123; // Number, not string, not object/buffer

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should allow requests passing IP check with explicit allowlist", async () => {
        const ipAddress = "127.0.0.1";
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { allowedIps: [ipAddress] },
          });
        req.params.id = "wh_ip_pass";
        Object.defineProperty(req, "ip", {
          value: ipAddress,
          configurable: true,
        });
        req.method = HTTP_METHODS.POST;

        // Mock the checkIpInRanges result since ssrf is mocked
        jest.mocked(ssrfMock.checkIpInRanges).mockReturnValue(true);

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should handle explicit undefined allowedIps override", async () => {
        const { middleware, req, res, next, webhookManager } =
          await createMiddlewareTestContext();
        req.params.id = "wh_undef_ips";
        req.method = HTTP_METHODS.POST;

        jest.mocked(webhookManager.getWebhookData).mockReturnValue(
          assertType({
            allowedIps: undefined,
          }),
        );

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should fallback to internal default when options.allowedIps is falsy", async () => {
        const { middleware, req, res, next, webhookManager } =
          await createMiddlewareTestContext({
            options: { allowedIps: assertType(null) },
          });
        req.params.id = "wh_undef_ips";
        req.method = HTTP_METHODS.POST;

        jest.mocked(webhookManager.getWebhookData).mockReturnValue(
          assertType({
            // Do not provide allowedIps to force evaluating options fallback
          }),
        );

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should handle explicit undefined authKey override", async () => {
        const { middleware, req, res, next, webhookManager } =
          await createMiddlewareTestContext();
        req.params.id = "wh_undef_auth";
        req.method = HTTP_METHODS.POST;
        req.headers[HTTP_HEADERS.X_API_KEY] = "secret";

        // already achieved via useMockCleanup()'s beforeEach
        // which already calls jest.clearAllMocks()
        jest.mocked(webhookManager.getWebhookData).mockReturnValue(
          assertType({
            authKey: undefined,
          }),
        );

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });

      it("should not mask headers when maskSensitiveData is false on offloaded request", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: { maskSensitiveData: false },
          });
        const webhookId = "wh_offload_nomask";
        const secret = "secret";
        req.params.id = webhookId;
        req.method = HTTP_METHODS.POST;
        req.isOffloaded = true;
        req.headers[HTTP_HEADERS.X_API_KEY] = secret;

        await middleware(req, res, next);
        // Verify webhook execution proceeded.
        const pushCall = jest
          .mocked(apifyMock.pushData)
          .mock.calls.find((c) => c[0] && c[0].webhookId === webhookId)?.[0];
        expect(pushCall).toBeDefined();
        expect(pushCall.headers[HTTP_HEADERS.X_API_KEY]).toBe(secret);
      });

      it("should proceed when jsonSchema validation passes", async () => {
        const { middleware, req, res, next } =
          await createMiddlewareTestContext({
            options: {
              jsonSchema: {
                type: "object",
                properties: { foo: { type: "string" } },
              },
            },
          });
        req.params.id = "wh_schema_pass";
        req.method = HTTP_METHODS.POST;
        req.body = { foo: "bar" };

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      });
    });
  });
});
