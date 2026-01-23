import { jest, describe, test, expect } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { createMiddlewareTestContext } from "../setup/helpers/middleware-test-utils.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType } from "../setup/helpers/test-utils.js";

/**
 * @typedef {import('../../src/typedefs.js').WebhookEvent} WebhookEvent
 */

await setupCommonMocks({ axios: true, apify: true });

describe("Logger Middleware", () => {
  useMockCleanup();

  test("should block invalid webhook ID", async () => {
    const ctx = await createMiddlewareTestContext({
      webhookManager: { isValid: false },
      request: { params: { id: "invalid" } },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(404);
  });

  test("should block unauthorized requests (Auth Key)", async () => {
    const ctx = await createMiddlewareTestContext({
      options: { authKey: "secret" },
      request: {
        params: { id: "wh_123" },
        query: { key: "wrong" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(401);
  });

  test("should block requests from non-whitelisted IPs", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        authKey: "secret",
        allowedIps: ["1.1.1.1"],
      },
      request: {
        params: { id: "wh_123" },
        ip: "2.2.2.2",
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(403);
  });

  test("should block oversized payloads", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        authKey: "secret",
        maxPayloadSize: 1024,
      },
      request: {
        params: { id: "wh_123" },
        query: { key: "secret" },
        headers: { "content-length": "2048" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(413);
  });

  test("should validate JSON Schema", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        authKey: "secret",
        jsonSchema: { type: "object", required: ["foo"] },
      },
      request: {
        params: { id: "wh_123" },
        method: "POST",
        query: { key: "secret" },
        headers: { "content-type": "application/json" },
        body: { bar: 1 },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(400);
  });

  test("should execute custom script", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        authKey: "secret",
        customScript: "event.body = 'TRANSFORMED'; event.responseBody = 'ok';",
      },
      request: {
        params: { id: "wh_123" },
        query: { key: "secret" },
        body: "original",
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    const event = /** @type {WebhookEvent} */ (ctx.onEvent.mock.calls[0][0]);
    expect(event.body).toBe("TRANSFORMED");
  });

  test("should convert Buffer body to string for logging", async () => {
    const bufferContent = Buffer.from('{"key":"value"}');
    const ctx = await createMiddlewareTestContext({
      options: { authKey: "secret" },
      request: {
        params: { id: "wh_123" },
        query: { key: "secret" },
        headers: { "content-type": "application/json" },
        body: bufferContent,
      },
    });

    // Simulate downstream handler sending response
    jest.mocked(ctx.next).mockImplementation(() => {
      ctx.res.send("ok");
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    const event = /** @type {WebhookEvent} */ (ctx.onEvent.mock.calls[0][0]);
    expect(typeof event.body).toBe("string");
    expect(event.body).toContain("key");
  });

  test("should calculate size correctly for object bodies", async () => {
    const bodyObj = { foo: "bar", baz: 123 };
    const ctx = await createMiddlewareTestContext({
      options: { authKey: "secret" },
      request: {
        params: { id: "wh_123" },
        query: { key: "secret" },
        headers: { "content-type": "application/json" },
        body: bodyObj,
      },
    });

    // Simulate downstream handler sending response
    jest.mocked(ctx.next).mockImplementation(() => {
      ctx.res.send("ok");
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    const event = /** @type {WebhookEvent} */ (ctx.onEvent.mock.calls[0][0]);
    expect(event.size).toBe(Buffer.byteLength(JSON.stringify(bodyObj)));
  });

  test("should handle array auth key by taking first element", async () => {
    const ctx = await createMiddlewareTestContext({
      options: { authKey: "secret" },
      request: {
        params: { id: "wh_123" },
        query: { key: ["secret", "wrong"] },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(200);
  });

  test("should return JSON response for 4xx error status codes", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        authKey: "secret",
        defaultResponseCode: 400,
      },
      request: {
        params: { id: "wh_123" },
        query: { key: "secret" },
        body: { test: "data" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(400);
    // 4xx with no custom body should return a JSON object
    const responseData = jest.mocked(ctx.res.json).mock.calls[0][0];
    expect(responseData).toHaveProperty("webhookId");
  });

  test("should return object responseBody as JSON", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        authKey: "secret",
        defaultResponseCode: 200,
        defaultResponseBody: assertType({
          status: "ok",
          custom: "response",
        }),
      },
      request: {
        params: { id: "wh_123" },
        query: { key: "secret" },
        body: { test: "data" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.statusCode).toBe(200);
    const responseData = jest.mocked(ctx.res.json).mock.calls[0][0];
    expect(responseData.status).toBe("ok");
    expect(responseData.custom).toBe("response");
  });

  test("should apply custom response headers from options", async () => {
    const ctx = await createMiddlewareTestContext({
      options: {
        authKey: "secret",
        defaultResponseHeaders: { "X-Custom-Header": "CustomValue" },
      },
      request: {
        params: { id: "wh_123" },
        query: { key: "secret" },
        body: { test: "data" },
      },
    });

    await ctx.middleware(ctx.req, ctx.res, ctx.next);

    expect(ctx.res.getHeader("X-Custom-Header")).toBe("CustomValue");
  });
});
