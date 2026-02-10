import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { createDatasetMock } from "../setup/helpers/shared-mocks.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { resetDb } from "../setup/helpers/db-hooks.js";
import { HTTP_STATUS } from "../../src/consts/http.js";

// Initialize mocks BEFORE imports
await setupCommonMocks({ apify: true, axios: false });

const { createLogsHandler } = await import("../../src/routes/logs.js");
const { logRepository } =
  await import("../../src/repositories/LogRepository.js");

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 * @typedef {import('../../src/typedefs.js').LogEntry} LogEntry
 */

describe("Unified Timestamp Filtering", () => {
  // Auto-cleanup mocks
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;
  /** @type {RequestHandler} */
  let handler;

  /** @type {LogEntry[]} */
  const items = assertType([
    {
      id: "A",
      timestamp: "2023-01-01T10:00:00.000Z",
      webhookId: "w1",
      method: "POST",
      statusCode: HTTP_STATUS.OK,
    },
    {
      id: "B",
      timestamp: "2023-01-02T10:00:00.000Z",
      webhookId: "w1",
      method: "POST",
      statusCode: HTTP_STATUS.OK,
    },
    {
      id: "C",
      timestamp: "2023-01-03T10:00:00.000Z",
      webhookId: "w1",
      method: "POST",
      statusCode: HTTP_STATUS.OK,
    },
  ]);

  beforeEach(async () => {
    await resetDb();

    for (const item of items) {
      await logRepository.insertLog(item);
    }

    createDatasetMock(items, { autoRegister: true });
    res = createMockResponse();
    next = createMockNextFunction();
    handler = createLogsHandler(assertType({ isValid: () => true }));
    jest.clearAllMocks();
  });

  describe("Legacy Compatibility (startTime / endTime)", () => {
    it("should filter by startTime (>=)", async () => {
      // startTime matches B and C
      req = createMockRequest({
        query: { startTime: "2023-01-02T00:00:00.000Z" },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(["B", "C"]));
      expect(ids).not.toContain("A");
    });

    it("should filter by endTime (<=)", async () => {
      // endTime matches A and B
      req = createMockRequest({
        query: { endTime: "2023-01-02T23:59:59.999Z" },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(["A", "B"]));
      expect(ids).not.toContain("C");
    });

    it("should filter by both startTime and endTime", async () => {
      // Just B
      req = createMockRequest({
        query: {
          startTime: "2023-01-02T00:00:00Z",
          endTime: "2023-01-02T23:59:59Z",
        },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(["B"]);
    });
  });

  describe("New Timestamp Range Filtering", () => {
    it("should filter by timestamp greater than (gt)", async () => {
      req = createMockRequest({
        query: { timestamp: { gt: "2023-01-01T10:00:00.000Z" } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(["B", "C"]));
      expect(ids).not.toContain("A");
    });

    it("should filter by timestamp less than (lt)", async () => {
      req = createMockRequest({
        query: { timestamp: { lt: "2023-01-02T10:00:00.000Z" } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(["A"]); // B is equal, so excluded
    });

    it("should combine legacy and new filters (intersection)", async () => {
      // startTime >= 2023-01-01 (All)
      // timestamp < 2023-01-03 (A, B)
      // Result: A, B
      req = createMockRequest({
        query: {
          startTime: "2023-01-01T00:00:00Z",
          timestamp: { lt: "2023-01-03T00:00:00Z" },
        },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(["A", "B"]));
      expect(ids).not.toContain("C");
    });
  });
});
