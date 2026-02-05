import { jest, describe, test, expect } from "@jest/globals";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { syncServiceMock, loggerMock } from "../setup/helpers/shared-mocks.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

await setupCommonMocks({ logger: true, sync: true });

const { createInfoHandler } = await import("../../src/routes/info.js");
const { createSystemMetricsHandler } =
  await import("../../src/routes/system.js");
const { escapeHtml, asyncHandler, createBroadcaster, jsonSafe } =
  await import("../../src/routes/utils.js");

describe("Routes Misc Coverage", () => {
  useMockCleanup();

  describe("info.js", () => {
    test("should return correct system info structure", () => {
      const mockWebhookManager = {
        getAllActive: jest.fn().mockReturnValue([{ id: "wh_1" }]),
      };
      const deps = {
        webhookManager: assertType(mockWebhookManager),
        getAuthKey: jest.fn().mockReturnValue("secret_key"),
        getRetentionHours: jest.fn().mockReturnValue(24),
        getMaxPayloadSize: jest.fn().mockReturnValue(1024 * 1024 * 5),
        version: "1.0.0",
      };

      const req = createMockRequest({
        headers: { host: "localhost:3000" },
        protocol: "http",
        get: assertType(jest.fn()).mockImplementation(
          /** @param {string} h */
          (h) => (h === "host" ? "localhost:3000" : undefined),
        ),
      });
      const res = createMockResponse();

      const handler = createInfoHandler(assertType(deps));
      handler(req, res, createMockNextFunction());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "1.0.0",
          status: "Enterprise Suite Online",
          system: expect.objectContaining({
            authActive: true,
            retentionHours: 24,
            maxPayloadLimit: "5.0MB",
            webhookCount: 1,
          }),
          endpoints: expect.objectContaining({
            logs: "http://localhost:3000/logs?limit=100",
          }),
        }),
      );
    });
  });

  describe("system.js", () => {
    test("should return sync metrics", async () => {
      syncServiceMock.getMetrics.mockReturnValue(
        assertType({
          lastSyncTime: "now",
          lastErrorTime: undefined,
        }),
      );

      const req = createMockRequest();
      const res = createMockResponse();

      const handler = createSystemMetricsHandler(syncServiceMock);
      await handler(req, res, createMockNextFunction());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
          sync: expect.objectContaining({
            lastSyncTime: "now",
            lastErrorTime: undefined,
          }),
        }),
      );
    });
  });

  describe("utils.js", () => {
    describe("escapeHtml", () => {
      test("should escape special characters", () => {
        const input = '<script>alert("xss")&\'</script>';
        const expected =
          "&lt;script&gt;alert(&quot;xss&quot;)&amp;&#039;&lt;/script&gt;";
        expect(escapeHtml(input)).toBe(expected);
      });

      test("should handle empty input", () => {
        expect(escapeHtml(assertType(null))).toBe("");
        expect(escapeHtml(assertType(undefined))).toBe("");
        expect(escapeHtml("")).toBe("");
      });
    });

    describe("asyncHandler", () => {
      test("should catch errors and pass to next", async () => {
        const error = new Error("Async boom");
        const failingFn = async () => {
          throw error;
        };
        const wrapped = asyncHandler(failingFn);

        const req = createMockRequest();
        const res = createMockResponse();
        const next = createMockNextFunction();

        await wrapped(req, res, next);
        expect(next).toHaveBeenCalledWith(error);
      });
    });

    describe("createBroadcaster", () => {
      test("should write data to all clients", () => {
        const mockClient1 = { write: jest.fn() };
        const mockClient2 = { write: jest.fn() };
        const clients = new Set([mockClient1, mockClient2]);

        const broadcast = createBroadcaster(assertType(clients));
        broadcast({ foo: "bar" });

        const expectedMsg = 'data: {"foo":"bar"}\n\n';
        expect(mockClient1.write).toHaveBeenCalledWith(expectedMsg);
        expect(mockClient2.write).toHaveBeenCalledWith(expectedMsg);
      });

      test("should remove client on write error", () => {
        const mockClientOk = { write: jest.fn() };
        const mockClientFail = {
          write: jest.fn().mockImplementation(() => {
            throw new Error("Write failed");
          }),
        };
        const clients = new Set([mockClientOk, mockClientFail]);

        const broadcast = createBroadcaster(assertType(clients));
        broadcast("test");

        expect(mockClientOk.write).toHaveBeenCalled();
        expect(clients.has(mockClientFail)).toBe(false);
        expect(clients.has(mockClientOk)).toBe(true);
        // Verify error logged
        expect(loggerMock.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(Object) }),
          "Failed to broadcast message to client",
        );
      });
    });

    describe("jsonSafe", () => {
      test("should serialize BigInt as Number", () => {
        const input = { val: BigInt(123), normal: 456 };
        const output = jsonSafe(input);
        expect(output).toEqual({ val: 123, normal: 456 });
      });
    });
  });
});
