import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  assertType,
  createMockNextFunction,
  createMockRequest,
  createMockResponse,
} from "../setup/helpers/test-utils.js";

// Setup mocks
await setupCommonMocks({ logger: true, consts: true });

const { createLogStreamHandler } = await import("../../src/routes/stream.js");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").NextFunction} NextFunction
 */

describe("Stream Route (SSE)", () => {
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;
  /** @type {Set<Response>} */
  let clients;

  beforeEach(() => {
    clients = new Set();

    req = createMockRequest();
    req.on = assertType(jest.fn()); // Mock event listener

    res = createMockResponse();
    res.flushHeaders = jest.fn();
    res.write = assertType(jest.fn());

    next = createMockNextFunction();

    loggerMock.error.mockClear();
  });

  test("should establish SSE connection successfully", () => {
    const handler = createLogStreamHandler(clients);
    handler(req, res, next);

    // Check Headers
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/event-stream",
    );
    expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
    expect(res.flushHeaders).toHaveBeenCalled();

    // Check content writing (connection message + padding)
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining(": connected"),
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining(" ".repeat(2048)),
    );

    // Check client tracking
    expect(clients.has(res)).toBe(true);
  });

  test("should reject connection if max clients reached", () => {
    // Fill up clients
    clients.add(assertType({}));
    clients.add(assertType({})); // size 2 = MAX_SSE_CLIENTS

    const handler = createLogStreamHandler(clients);
    handler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Service Unavailable" }),
    );
    expect(clients.size).toBe(2); // Should not increase
  });

  test("should remove client on close", () => {
    const handler = createLogStreamHandler(clients);
    handler(req, res, next);

    expect(clients.has(res)).toBe(true);
    expect(req.on).toHaveBeenCalledWith("close", expect.any(Function));

    // Simulate close
    const closeHandler = jest
      .mocked(req.on)
      .mock.calls.find((call) => call[0] === "close")?.[1];
    closeHandler?.();

    expect(clients.has(res)).toBe(false);
  });

  test("should handle write errors gracefully", () => {
    jest.mocked(res.write).mockImplementation(() => {
      throw new Error("Write failed");
    });

    const handler = createLogStreamHandler(clients);
    handler(req, res, next);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      "Failed to establish SSE stream",
    );
    // Client should NOT be added if handshake failed
    expect(clients.has(res)).toBe(false);
  });
});
