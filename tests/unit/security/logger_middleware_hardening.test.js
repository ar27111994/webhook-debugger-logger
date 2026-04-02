/**
 * @file tests/unit/security/logger_middleware_hardening.test.js
 * @description Hardening tests for LoggerMiddleware core logic.
 * Targets: Sandbox security, circularity, abort signals, and concurrency.
 */

import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import {
  useMockCleanup,
  useFakeTimers,
} from "../../setup/helpers/test-lifecycle.js";
import { jest } from "@jest/globals";
import { assertType } from "../../setup/helpers/test-utils.js";

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
  storage: true,
});

const { HTTP_HEADERS, HTTP_STATUS, HTTP_METHODS, MIME_TYPES, ENCODINGS } =
  await import("../../../src/consts/http.js");
const { ERROR_MESSAGES } = await import("../../../src/consts/errors.js");
const { APP_CONSTS, STREAM_EVENTS } = await import("../../../src/consts/app.js");
const { LOG_MESSAGES } = await import("../../../src/consts/messages.js");
const { LOG_CONSTS } = await import("../../../src/consts/logging.js");
const { AUTH_CONSTS } = await import("../../../src/consts/auth.js");
const { ALERT_TRIGGERS } = await import("../../../src/consts/alerting.js");

const { createMiddlewareTestContext } =
  await import("../../setup/helpers/middleware-test-utils.js");

const {
  loggerMock,
  forwardingServiceMock,
  apifyMock,
  storageHelperMock,
  constsMock,
  webhookManagerMock,
} = await import("../../setup/helpers/shared-mocks.js");

const { LoggerMiddleware } = await import("../../../src/logger_middleware.js");

describe("LoggerMiddleware Hardening", () => {
  useFakeTimers();
  useMockCleanup();

  const WEBHOOK_ID = "wh_test_123";
  const SHORT_TIMEOUT_MS = 10;
  const MED_TIMEOUT_MS = 50;
  const TIMEOUT_OFFSET_MS = 10;
  const OVERFLOW_BYTES = 100;
  const BUFFER_BYTES = 1000;

  describe("Sandbox Security (Prototype Pollution & Globals)", () => {
    it("should isolate custom scripts from process and global prototypes", async () => {
      const timeout = 10;
      const context = await createMiddlewareTestContext({
        options: {
          customScript: `
            if (Object.prototype) {
              Object.prototype.polluted = "yes";
            }
            event.processType = typeof process;
            event.requireType = typeof require;
          `,
        },
      });
      context.req.params.id = WEBHOOK_ID;

      await context.middleware(context.req, context.res, context.next);
      await jest.advanceTimersByTimeAsync(timeout);

      expect(context.onEvent).toHaveBeenCalled();

      // Verify global state wasn't polluted
      // @ts-expect-error - testing prototype pollution
      expect({}.polluted).toBeUndefined();

      const [event] = context.onEvent.mock.calls[0];
      // @ts-expect-error - testing prototype pollution
      expect(event.processType).toBe("undefined");
      // @ts-expect-error - testing prototype pollution
      expect(event.requireType).toBe("undefined");

      expect(context.res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(context.res.send).toHaveBeenCalled();
    });

    it("should prevent prototype access via constructor for passed objects", async () => {
      const timeout = 10;
      const context = await createMiddlewareTestContext({
        options: {
          customScript: `
            try {
               req.constructor.prototype.leaked = true;
               if (event && event.headers && event.headers.__proto__) {
                 event.headers.__proto__.leaked = true;
               }
            } catch (e) {
               event.sandboxError = e.message;
            }
          `,
        },
      });
      context.req.params.id = WEBHOOK_ID;

      await context.middleware(context.req, context.res, context.next);
      await jest.advanceTimersByTimeAsync(timeout);

      expect(context.onEvent).toHaveBeenCalled();
      // Verify no leak in the main thread objects
      // @ts-expect-error - testing prototype pollution
      expect({}.leaked).toBeUndefined();

      /** @type {any} */
      const [event] = context.onEvent.mock.calls[0];
      expect(event.sandboxError).toContain(
        "Cannot read properties of undefined",
      );

      expect(context.res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(context.res.send).toHaveBeenCalled();

      // The test intentionally throws an error within the script, but because the script
      // is executed in an isolated VM context and then caught and assigned to event.sandboxError,
      // the main thread still continues properly!
    });

    it("should prevent custom script from mutating the original req.headers via safeReq", async () => {
      const context = await createMiddlewareTestContext({
        options: {
          // Try to leak / poison via mutation
          customScript:
            "event.req.headers['x-hacked'] = 'true'; event.req.body = { hacked: true };",
        },
      });

      context.req.params.id = WEBHOOK_ID;
      context.req.headers["x-original"] = "safe";

      await context.middleware(context.req, context.res, context.next);

      // Assert mutations inside sandbox do not leak to actual req object
      expect(context.req.headers["x-hacked"]).toBeUndefined();
      expect(context.req.headers["x-original"]).toBe("safe");
      expect(context.req.body).not.toHaveProperty("hacked");
    });

    it("should parse safeReq.query safely and use HTTP_STATUS global constant correctly", async () => {
      const context = await createMiddlewareTestContext({
        options: {
          customScript: `
                        event.extractedQuery = req.query.foo;
                        event.assignedStatus = HTTP_STATUS.PAYLOAD_TOO_LARGE;
                        event.statusCode = HTTP_STATUS.PAYLOAD_TOO_LARGE;
                    `,
        },
      });

      context.req.params.id = WEBHOOK_ID;
      context.req.query = { foo: "bar" };

      await context.middleware(context.req, context.res, context.next);
      await jest.runAllTimersAsync();

      // Script manipulated the HTTP_STATUS globally exposed inside the context correctly!
      expect(context.res.status).toHaveBeenCalledWith(
        HTTP_STATUS.PAYLOAD_TOO_LARGE,
      );
      expect(context.res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: LOG_MESSAGES.WEBHOOK_RECEIVED_STATUS(
            HTTP_STATUS.PAYLOAD_TOO_LARGE,
          ),
          webhookId: WEBHOOK_ID,
        }),
      );
      expect(context.onEvent).toHaveBeenCalled();

      /** @type {any} */
      const [event] = context.onEvent.mock.calls[0];
      // Verify query parsing correctly survived stringification boundaries isolating global prototypes
      expect(event.extractedQuery).toBe("bar");
      expect(event.assignedStatus).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE);
    });
  });

  describe("Circular Redaction & Deep JSON Stress", () => {
    it("should handle circular references in redaction path by falling back to String()", async () => {
      const timeout = SHORT_TIMEOUT_MS;
      const context = await createMiddlewareTestContext({
        options: { redactBodyPaths: ["body.secret"] },
      });
      context.req.params.id = WEBHOOK_ID;

      const circular = { secret: "PII" };
      // @ts-expect-error - testing circularity
      circular.self = circular;
      context.req.body = circular;
      context.req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.JSON;

      await context.middleware(context.req, context.res, context.next);
      await jest.advanceTimersByTimeAsync(timeout);

      expect(context.res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(context.onEvent).toHaveBeenCalled();
      /** @type {any} */
      const [event] = context.onEvent.mock.calls[0];
      expect(event).toBeDefined();
      expect(typeof event.body).toBe("string");
      // When attempting to recursively redact a circular object deep within the body,
      // JSON.stringify will fail natively, which means the fallback path returns [object Object]
      // We just want to make sure it doesn't crash middleware and continues
      expect(event.body).toContain(LOG_MESSAGES.OBJECT_PLACEHOLDER);
    });
  });

  describe("Abort Signal Integrity (Background Tasks)", () => {
    it("should verify signal becomes aborted when background task timeout hits", async () => {
      const timeout =
        APP_CONSTS.BACKGROUND_TASK_TIMEOUT_TEST_MS + TIMEOUT_OFFSET_MS;
      const context = await createMiddlewareTestContext({
        options: { forwardUrl: "https://hang.test" },
      });
      context.req.params.id = WEBHOOK_ID;

      // Mock pushData to resolve immediately so we reach forwarding logic
      apifyMock.pushData.mockResolvedValue(undefined);

      // Capture signal
      /** @type {AbortSignal | undefined} */
      let capturedSignal;
      forwardingServiceMock.forwardWebhook.mockImplementation(
        (_event, _request, _options, _forwardingService, signal) => {
          capturedSignal = signal;
          return new Promise(() => { });
        },
      );

      // Start middleware (don't await it yet because it hangs on forwardingServiceMock)
      const middlewarePromise = context.middleware(
        context.req,
        context.res,
        context.next,
      );

      // Wait for background timeout
      await jest.advanceTimersByTimeAsync(timeout);

      // Now await the middleware as the internal Promse.race timeout has fired
      await middlewarePromise;

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: WEBHOOK_ID,
          eventId: expect.any(String),
        }),
        LOG_MESSAGES.BACKGROUND_TIMEOUT,
      );

      expect(capturedSignal).toBeDefined();
      if (capturedSignal) {
        expect(capturedSignal.aborted).toBe(true);
      }
    });
  });

  describe("Header Masking & Status Code Resilience", () => {
    it("should mask sensitive headers regardless of case (Case-Insensitive Masking)", async () => {
      const timeout = MED_TIMEOUT_MS;
      const context = await createMiddlewareTestContext({
        options: { maskSensitiveData: true },
      });
      context.req.params.id = WEBHOOK_ID;

      const authHeader = HTTP_HEADERS.AUTHORIZATION.toUpperCase();
      const apiKeyHeader = HTTP_HEADERS.X_API_KEY.toLowerCase();
      const cookieHeader =
        HTTP_HEADERS.COOKIE.charAt(0).toUpperCase() +
        HTTP_HEADERS.COOKIE.slice(1);

      context.req.headers[authHeader] = `${AUTH_CONSTS.BEARER_PREFIX}secret`;
      context.req.headers[apiKeyHeader] = "key";
      context.req.headers[cookieHeader] = "sess=1";

      await context.middleware(context.req, context.res, context.next);
      await jest.advanceTimersByTimeAsync(timeout);

      expect(context.onEvent).toHaveBeenCalled();

      /** @type {any} */
      const [event] = context.onEvent.mock.calls[0];
      expect(event).toBeDefined();
      expect(event.headers).toBeDefined();
      expect(event.headers[authHeader]).toBe(LOG_CONSTS.MASKED_VALUE);
      expect(event.headers[apiKeyHeader]).toBe(LOG_CONSTS.MASKED_VALUE);
      expect(event.headers[cookieHeader]).toBe(LOG_CONSTS.MASKED_VALUE);
    });

    it("should handle invalid types and Symbols in getValidStatusCode", () => {
      const fallback = HTTP_STATUS.INTERNAL_SERVER_ERROR;
      expect(
        LoggerMiddleware.getValidStatusCode(Symbol("fail"), fallback),
      ).toBe(fallback);
      expect(LoggerMiddleware.getValidStatusCode(NaN, fallback)).toBe(fallback);
    });
  });

  describe("KVS Fault Tolerance (Streaming)", () => {
    it("should fallback to local handling if offloadToKvs throws during ingest", async () => {
      const ORIGINAL_THRESHOLD =
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD;

      try {
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD =
          APP_CONSTS.BYTES_PER_KB;

        const largeSize =
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + OVERFLOW_BYTES;
        const maxPayloadSize = largeSize + BUFFER_BYTES;
        const errorMessage = "KVS_UNAVAILABLE";
        const context = await createMiddlewareTestContext({
          options: { maxPayloadSize },
        });
        context.req.params.id = WEBHOOK_ID;
        context.req.method = HTTP_METHODS.POST;
        context.req.headers[HTTP_HEADERS.CONTENT_LENGTH] = String(largeSize);

        storageHelperMock.offloadToKvs.mockRejectedValue(
          new Error(errorMessage),
        );

        const ingestPromise = context.middleware.ingestMiddleware(
          context.req,
          context.res,
          context.next,
        );

        context.req.emit(STREAM_EVENTS.DATA, Buffer.alloc(largeSize));
        context.req.emit(STREAM_EVENTS.CLOSE);

        await ingestPromise;

        expect(context.res.status).toHaveBeenCalledWith(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        );
        expect(context.res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: ERROR_MESSAGES.PAYLOAD_STREAM_FAILED,
            details: String(new Error(errorMessage)),
          }),
        );
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Object) }),
          LOG_MESSAGES.STREAM_OFFLOAD_FAILED,
        );
        expect(context.next).not.toHaveBeenCalled();
        expect(storageHelperMock.offloadToKvs).toHaveBeenCalled();
        expect(context.req.isOffloaded).toBeUndefined(); // never set because it threw
      } finally {
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD = ORIGINAL_THRESHOLD;
      }
    });

    it("should respond with 500 if getKvsUrl throws after offloadToKvs succeeds", async () => {
      const ORIGINAL_THRESHOLD =
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD;

      try {
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD =
          APP_CONSTS.BYTES_PER_KB;

        const largeSize =
          constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD + OVERFLOW_BYTES;
        const maxPayloadSize = largeSize + BUFFER_BYTES;
        const errorMessage = "URL_FETCH_FAILED";
        const context = await createMiddlewareTestContext({
          options: { maxPayloadSize },
        });
        context.req.params.id = WEBHOOK_ID;
        context.req.method = HTTP_METHODS.POST;
        context.req.headers[HTTP_HEADERS.CONTENT_LENGTH] = String(largeSize);

        storageHelperMock.offloadToKvs.mockResolvedValue(undefined);
        storageHelperMock.getKvsUrl.mockRejectedValue(new Error(errorMessage));

        const ingestPromise = context.middleware.ingestMiddleware(
          context.req,
          context.res,
          context.next,
        );

        context.req.emit(STREAM_EVENTS.DATA, Buffer.alloc(largeSize));
        context.req.emit(STREAM_EVENTS.CLOSE);

        await ingestPromise;

        expect(context.res.status).toHaveBeenCalledWith(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        );
        expect(context.res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: ERROR_MESSAGES.PAYLOAD_STREAM_FAILED,
            details: String(new Error(errorMessage)),
          }),
        );
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Object) }),
          LOG_MESSAGES.STREAM_OFFLOAD_FAILED,
        );
        expect(context.next).not.toHaveBeenCalled();
      } finally {
        constsMock.STORAGE_CONSTS.KVS_OFFLOAD_THRESHOLD = ORIGINAL_THRESHOLD;
      }
    });
  });

  describe("Defensive Validation & Request Properties", () => {
    it("should call next with error if req.ip is falsey and req.socket is undefined", async () => {
      const context = await createMiddlewareTestContext();
      context.req.params.id = WEBHOOK_ID;

      // Deliberately corrupt the request object to throw in #validateWebhookRequest
      Object.defineProperty(context.req, "ip", { value: undefined });
      Object.defineProperty(context.req, "socket", { value: undefined });

      await context.middleware(context.req, context.res, context.next);

      expect(context.next).toHaveBeenCalledWith(expect.any(TypeError));
      expect(context.res.send).not.toHaveBeenCalled();
    });

    it("should gracefully reject recursive requests with the loop suffix", async () => {
      const context = await createMiddlewareTestContext();
      context.req.params.id = WEBHOOK_ID;
      context.req.headers[constsMock.RECURSION_HEADER_NAME] =
        `${constsMock.RECURSION_HEADER_VALUE}${constsMock.RECURSION_HEADER_LOOP_SUFFIX}`;

      await context.middleware.ingestMiddleware(
        context.req,
        context.res,
        context.next,
      );

      expect(context.res.status).toHaveBeenCalledWith(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
      );
      expect(context.res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: ERROR_MESSAGES.RECURSIVE_FORWARDING,
        }),
      );
      expect(context.next).not.toHaveBeenCalled();
    });
  });

  describe("Advanced Core Scenarios (Behavioral Gaps)", () => {
    it("should parse Content-Type with charset parameters correctly", async () => {
      const context = await createMiddlewareTestContext();
      context.req.params.id = WEBHOOK_ID;
      context.req.headers[HTTP_HEADERS.CONTENT_TYPE] =
        `${MIME_TYPES.JSON}; charset=${ENCODINGS.UTF8}`;
      context.req.body = { test: "data" };

      await context.middleware(context.req, context.res, context.next);
      await jest.runAllTimersAsync();

      expect(context.onEvent).toHaveBeenCalled();
      /** @type {any} */
      const [event] = context.onEvent.mock.calls[0];
      expect(event.contentType).toBe(MIME_TYPES.JSON);
    });

    it("should skip redaction silently when body is a Buffer, even if redactBodyPaths is set", async () => {
      const context = await createMiddlewareTestContext({
        options: { redactBodyPaths: ["body.secret"] },
      });
      context.req.params.id = WEBHOOK_ID;

      const rawBuffer = Buffer.from("random binary data");
      context.req.body = rawBuffer;
      context.req.headers[HTTP_HEADERS.CONTENT_TYPE] = MIME_TYPES.OCTET_STREAM;

      await context.middleware(context.req, context.res, context.next);
      await jest.runAllTimersAsync();

      expect(context.onEvent).toHaveBeenCalled();
      /** @type {any} */
      const [event] = context.onEvent.mock.calls[0];

      expect(event.body).toBe(rawBuffer.toString(ENCODINGS.BASE64));
      expect(event.bodyEncoding).toBe(ENCODINGS.BASE64);
      expect(event.body).not.toContain(LOG_CONSTS.CENSOR_MARKER);
    });

    it("should send null response directly via res.send when custom script sets event.responseBody = null", async () => {
      const context = await createMiddlewareTestContext({
        options: {
          customScript: "event.responseBody = null;",
        },
      });
      context.req.params.id = WEBHOOK_ID;
      context.req.body = {};

      await context.middleware(context.req, context.res, context.next);
      await jest.runAllTimersAsync();

      expect(context.res.send).toHaveBeenCalledWith(null);
      expect(context.res.json).not.toHaveBeenCalled();
    });

    it("should prefer explicit alertOn array over fallback and pass full config/context", async () => {
      const { alertingMock } = await import("../../setup/helpers/shared-mocks.js");
      const context = await createMiddlewareTestContext({
        options: {
          alerts: {
            slack: { webhookUrl: "https://hooks.slack.com/services/test" },
            discord: { webhookUrl: "https://discord.test" },
          },
          alertOn: [ALERT_TRIGGERS.SIGNATURE_INVALID],
        },
      });
      context.req.params.id = WEBHOOK_ID;

      await context.middleware(context.req, context.res, context.next);
      await jest.runAllTimersAsync();

      expect(alertingMock.triggerAlertIfNeeded).toHaveBeenCalledWith(
        expect.objectContaining({
          alertOn: [ALERT_TRIGGERS.SIGNATURE_INVALID],
          slack: expect.any(Object),
          discord: expect.any(Object),
        }),
        expect.objectContaining({
          webhookId: WEBHOOK_ID,
          method: context.req.method,
          statusCode: HTTP_STATUS.OK,
          signatureValid: undefined,
          signatureError: undefined,
          timestamp: expect.any(String),
          sourceIp: undefined,
        }),
      );
    });

    it("should handle multiple concurrent requests without data leakage", async () => {
      const MARKER_1 = 1;
      const MARKER_2 = 2;
      const webhookId = "req1";
      const webhookId2 = "req2";
      const context1 = await createMiddlewareTestContext({
        options: { customScript: `event.marker = ${MARKER_1};` },
      });
      context1.req.params.id = webhookId;

      const context2 = await createMiddlewareTestContext({
        options: { customScript: `event.marker = ${MARKER_2};` },
      });
      context2.req.params.id = webhookId2;

      const req1Promise = context1.middleware(
        context1.req,
        context1.res,
        context1.next,
      );
      const req2Promise = context2.middleware(
        context2.req,
        context2.res,
        context2.next,
      );

      await jest.runAllTimersAsync();
      await Promise.all([req1Promise, req2Promise]);

      expect(context1.onEvent).toHaveBeenCalledTimes(1);
      expect(context2.onEvent).toHaveBeenCalledTimes(1);

      /** @type {any} */
      const [evt1] = context1.onEvent.mock.calls[0];
      /** @type {any} */
      const [evt2] = context2.onEvent.mock.calls[0];

      expect(evt1.marker).toBe(MARKER_1);
      expect(evt2.marker).toBe(MARKER_2);
      expect(evt1.webhookId).toBe(webhookId);
      expect(evt2.webhookId).toBe(webhookId2);
    });

    it("should trigger ACTOR_PUSH_DATA_TIMEOUT during executeBackgroundTasks correctly", async () => {
      const TIMEOUT_SLACK_MS = 50;
      const context = await createMiddlewareTestContext();
      context.req.params.id = WEBHOOK_ID;

      // Make pushData hang indefinitely so inner timeout triggers
      apifyMock.pushData.mockImplementation(() => new Promise(() => { }));

      const middlewarePromise = context.middleware(
        context.req,
        context.res,
        context.next,
      );

      // Advance by exact outer background task timeout + some slack so Promise.race fails safely with timeout error inside execution
      await jest.advanceTimersByTimeAsync(
        APP_CONSTS.BACKGROUND_TASK_TIMEOUT_TEST_MS + TIMEOUT_SLACK_MS,
      );

      await middlewarePromise;

      // Expect the inner push data timeout to be logged, and the outer loop shouldn't time out because the inner error was caught
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: expect.any(String),
          isPlatformError: expect.any(Boolean),
          err: expect.objectContaining({
            message: expect.stringContaining("timeout"),
          }),
        }),
        LOG_MESSAGES.BACKGROUND_ERROR,
      );
      expect(loggerMock.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: WEBHOOK_ID,
          eventId: expect.any(String),
        }),
        LOG_MESSAGES.BACKGROUND_TIMEOUT,
      );
    });
  });

  describe("Final Edge Cases & Structural Tests", () => {
    it("should clear compiled resources (script & validator) when removed via updateOptions", async () => {
      const { middleware, req, res, next, onEvent } =
        await createMiddlewareTestContext({
          options: {
            customScript: "event.x = 1;",
            jsonSchema: { type: "object", additionalProperties: true },
          },
        });
      expect(middleware.hasCompiledScript()).toBe(true);
      expect(middleware.hasValidator()).toBe(true);

      // Re-update empty to clear the script and schema
      middleware.updateOptions({});
      expect(middleware.hasCompiledScript()).toBe(false);
      expect(middleware.hasValidator()).toBe(false);

      req.params.id = WEBHOOK_ID;
      const p = middleware(req, res, next);
      await jest.runAllTimersAsync();
      await p;

      expect(onEvent).toHaveBeenCalled();
      /** @type {any} */
      const [event] = onEvent.mock.calls[0];
      expect(event.x).toBeUndefined();
    });

    it("should strictly block specific protected keys injected via per-webhook data", async () => {
      const { middleware, req, res, next } = await createMiddlewareTestContext({
        options: {
          authKey: "GLOBAL_SECRET",
          customScript: "event.safe = true;",
        },
      });

      jest.mocked(webhookManagerMock.getWebhookData).mockReturnValue(
        assertType({
          authKey: "", // attempt to override and remove auth
          allowedIps: [], // attempt to remove IP constraints
          customScript: "event.hacked = true;", // attempt to inject script
        }),
      );

      req.params.id = "wh_atomic";

      // We test unauthorized access (no auth header) which SHOULD fail if authKey is protected
      await middleware(req, res, next);

      // Because authKey is protected, the override to "" fails, so auth is still "GLOBAL_SECRET".
      // Therefore, the request without credentials must fail with 401.
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(next).not.toHaveBeenCalled();
    });

    it("should process requests through the same middleware instance producing distinct event objects", async () => {
      const {
        middleware,
        req: req1,
        res: res1,
        next: next1,
        onEvent,
      } = await createMiddlewareTestContext({
        options: { customScript: "event.id_copy = event.id;" },
      });

      const {
        req: req2,
        res: res2,
        next: next2,
      } = await createMiddlewareTestContext();

      req1.params.id = "req1";
      req2.params.id = "req2";

      // Two simultaneous requests through the SAME instance
      const p1 = middleware(req1, res1, next1);
      const p2 = middleware(req2, res2, next2);
      await jest.runAllTimersAsync();
      await Promise.all([p1, p2]);

      const EXPECTED_CALL_COUNT = 2;
      expect(onEvent).toHaveBeenCalledTimes(EXPECTED_CALL_COUNT);

      // Verify each call produced a distinct event with its own ID
      const [evt1Args, evt2Args] = onEvent.mock.calls;
      /** @type {any} */
      const evt1 = evt1Args[0];
      /** @type {any} */
      const evt2 = evt2Args[0];

      expect(evt1.id).not.toBe(evt2.id);
      expect(evt1.id_copy).toBe(evt1.id);
      expect(evt2.id_copy).toBe(evt2.id);

      // Verify ID format
      const idLength = APP_CONSTS.DEFAULT_ID_LENGTH;
      expect(typeof evt1.id).toBe("string");
      expect(evt1.id.length).toBe(idLength);
      expect(evt2.id.length).toBe(idLength);
    });

    it("should execute mid-flight requests utilizing the current script at prepareRequestData time", async () => {
      const { middleware, req, res, next, onEvent } =
        await createMiddlewareTestContext({
          options: { customScript: "event.version = 1;" },
        });

      req.params.id = WEBHOOK_ID;

      // Start request — yields at await #prepareRequestData
      const middlewarePromise = middleware(req, res, next);

      // Hot-swap script synchronously before the microtask queue runs the middleware continuation
      // This tests that #compiledScript isn't captured at the start of the request, but rather read
      // later when #transformRequestData is invoked.
      middleware.updateOptions({ customScript: "event.version = 2;" });

      await jest.runAllTimersAsync();

      await jest.runAllTimersAsync();
      await middlewarePromise;

      expect(onEvent).toHaveBeenCalled();
      /** @type {any} */
      const [event] = onEvent.mock.calls[0];
      // Due to the TOCTOU gap in how instances update compiled scripts but they are checked later
      // The event uses the currently compiled script at transformRequestData time.
      const EXPECTED_VERSION = 2;
      expect(event.version).toBe(EXPECTED_VERSION);
    });
  });
});
