import { jest } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  createDatasetMock,
  constsMock,
} from "../setup/helpers/shared-mocks.js";
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  assertType,
} from "../setup/helpers/test-utils.js";
import { resetDb } from "../setup/helpers/db-hooks.js";

// Initialize mocks BEFORE imports
await setupCommonMocks({ apify: true, axios: false });

const { createLogsHandler } = await import("../../src/routes/logs.js");
import { logRepository } from "../../src/repositories/LogRepository.js";

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 * @typedef {import('../../src/typedefs.js').LogEntry} LogEntry
 */

describe("Advanced Filtering", () => {
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

  beforeEach(() => {
    res = createMockResponse();
    next = createMockNextFunction();
    handler = createLogsHandler(assertType({ isValid: () => true }));
    jest.clearAllMocks();
  });

  describe("Numeric Range Filtering", () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "A",
        statusCode: constsMock.HTTP_STATUS.OK,
        processingTime: 50,
        size: 100,
        timestamp: "2023-01-01T10:00:00Z",
        webhookId: "w1",
        method: "GET",
        remoteIp: "127.0.0.1",
        headers: {},
        query: {},
        body: {},
        contentType: "application/json",
      },
      {
        id: "B",
        statusCode: constsMock.HTTP_STATUS.NOT_FOUND,
        processingTime: 150,
        size: 500,
        timestamp: "2023-01-01T10:00:01Z",
        webhookId: "w1",
        method: "POST",
        remoteIp: "127.0.0.1",
        headers: {},
        query: {},
        body: {},
        contentType: "application/json",
      },
      {
        id: "C",
        statusCode: constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR,
        processingTime: 300,
        size: 1000,
        timestamp: "2023-01-01T10:00:02Z",
        webhookId: "w1",
        method: "PUT",
        remoteIp: "127.0.0.1",
        headers: {},
        query: {},
        body: {},
        contentType: "application/json",
      },
    ]);

    beforeEach(async () => {
      // Use helper for clean DB reset
      await resetDb();

      // Use batch insert for atomicity and speed
      await logRepository.batchInsertLogs(items);

      createDatasetMock(items, { autoRegister: true });
    });

    it("should filter by statusCode greater than (gt)", async () => {
      // statusCode[gt]=constsMock.HTTP_STATUS.OK -> should match constsMock.HTTP_STATUS.NOT_FOUND, constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR
      req = createMockRequest({
        query: { statusCode: { gt: constsMock.HTTP_STATUS.OK.toString() } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(["B", "C"]));
      expect(ids).not.toContain("A");
    });

    it("should filter by statusCode legacy exact match", async () => {
      // statusCode=constsMock.HTTP_STATUS.NOT_FOUND -> should match constsMock.HTTP_STATUS.NOT_FOUND
      req = createMockRequest({
        query: { statusCode: constsMock.HTTP_STATUS.NOT_FOUND.toString() },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items.map((/** @type {LogEntry} */ i) => i.id)).toEqual([
        "B",
      ]);
    });

    it("should filter by processingTime less than or equal (lte)", async () => {
      // processingTime[lte]=150 -> A(50), B(150); C(300) excluded
      req = createMockRequest({ query: { processingTime: { lte: "150" } } });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items.map((/** @type {LogEntry} */ i) => i.id)).toEqual(
        expect.arrayContaining(["A", "B"]),
      );
      expect(output.items).toHaveLength(2);
    });

    it("should filter by size range (gt AND lt)", async () => {
      // size[gt]=100 & size[lt]=1000 -> B(constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR) only
      req = createMockRequest({ query: { size: { gt: "100", lt: "1000" } } });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items.map((/** @type {LogEntry} */ i) => i.id)).toEqual([
        "B",
      ]);
    });

    test("should handle date objects in range queries", async () => {
      await resetDb();

      const commonFields = {
        method: "POST",
        statusCode: constsMock.HTTP_STATUS.OK,
        processingTime: 10,
        size: 100,
        remoteIp: "127.0.0.1",
        headers: {},
        query: {},
        body: {},
        contentType: "application/json",
      };

      await logRepository.batchInsertLogs([
        // Out of range (past)
        {
          id: "D",
          timestamp: "2023-01-01T09:00:00Z",
          webhookId: "w1",
          ...commonFields,
        },
        // In range
        {
          id: "E",
          timestamp: "2023-01-01T10:30:00Z",
          webhookId: "w1",
          ...commonFields,
        },
        // In range
        {
          id: "F",
          timestamp: "2023-01-01T11:00:00Z",
          webhookId: "w1",
          ...commonFields,
        },
        // Out of range (future)
        {
          id: "G",
          timestamp: "2023-01-01T12:00:00Z",
          webhookId: "w1",
          ...commonFields,
        },
      ]);

      // timestamp[gt]=2023-01-01T10:00:00Z & timestamp[lt]=2023-01-01T11:30:00Z
      // Should match E and F
      req = createMockRequest({
        query: {
          timestamp: {
            gt: "2023-01-01T10:00:00Z",
            lt: "2023-01-01T11:30:00Z",
          },
        },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(["E", "F"]));
      expect(ids).not.toContain("D");
      expect(ids).not.toContain("G");
      expect(ids).toHaveLength(2);
    });

    it("should handle not equal (ne)", async () => {
      // statusCode[ne]=constsMock.HTTP_STATUS.OK -> B(constsMock.HTTP_STATUS.NOT_FOUND), C(constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR)
      req = createMockRequest({
        query: { statusCode: { ne: constsMock.HTTP_STATUS.OK.toString() } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(["B", "C"]));
      expect(ids).not.toContain("A");
    });

    it("should filter by greater than or equal (gte)", async () => {
      // statusCode[gte]=constsMock.HTTP_STATUS.OK -> A(constsMock.HTTP_STATUS.OK), B(constsMock.HTTP_STATUS.NOT_FOUND), C(constsMock.HTTP_STATUS.INTERNAL_SERVER_ERROR)
      req = createMockRequest({
        query: { statusCode: { gte: constsMock.HTTP_STATUS.OK.toString() } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      const ids = output.items.map((/** @type {LogEntry} */ i) => i.id);
      expect(ids).toHaveLength(3);
      expect(ids).toEqual(expect.arrayContaining(["A", "B", "C"]));
    });

    it("should filter by less than (lt)", async () => {
      // statusCode[lt]=constsMock.HTTP_STATUS.OK -> None (A is constsMock.HTTP_STATUS.OK)
      // Let's verify boundary strictness
      req = createMockRequest({
        query: { statusCode: { lt: constsMock.HTTP_STATUS.OK.toString() } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items).toHaveLength(0);
    });

    it("should filter by explicit equal (eq)", async () => {
      // statusCode[eq]=constsMock.HTTP_STATUS.OK -> A(constsMock.HTTP_STATUS.OK)
      req = createMockRequest({
        query: { statusCode: { eq: constsMock.HTTP_STATUS.OK.toString() } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items.map((/** @type {LogEntry} */ i) => i.id)).toEqual([
        "A",
      ]);
    });

    it("should filter by complex mixed range (gt and lt overlap)", async () => {
      // 50 < processingTime < 300 -> B(150)
      // A is 50 (excluded by gt), C is 300 (excluded by lt)
      req = createMockRequest({
        query: { processingTime: { gt: "50", lt: "300" } },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items.map((/** @type {LogEntry} */ i) => i.id)).toEqual([
        "B",
      ]);
    });

    it("should return empty for impossible range (gt > lt)", async () => {
      // size > 1000 AND size < 100 -> Impossible
      req = createMockRequest({ query: { size: { gt: "1000", lt: "100" } } });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items).toHaveLength(0);
    });

    it("should ignore invalid numeric values in range", async () => {
      // statusCode[gt]=invalid -> Should be ignored or treated as no-match depending on implementation.
      // Current implementation: parseRangeQuery ignores invalid numbers.
      // If matchesRange receives empty conditions -> returns true (match all)
      // Logically: if condition value is NaN, it's dropped.
      // If ALL conditions dropped -> matchesRange returns true (no filter).
      // Let's verify this behavior: "gt: abc" -> match all.
      req = createMockRequest({ query: { statusCode: { gt: "abc" } } });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      // Expect all items because the filter is effectively invalid/ignored
      expect(output.items).toHaveLength(3);
    });
  });

  describe("IP CIDR Filtering", () => {
    /** @type {LogEntry[]} */
    const items = assertType([
      {
        id: "1",
        remoteIp: "192.168.1.5",
        timestamp: "2023-01-01",
        webhookId: "w1",
        method: "GET",
        statusCode: constsMock.HTTP_STATUS.OK,
        processingTime: 10,
        size: 100,
        headers: {},
        query: {},
        body: {},
        contentType: "application/json",
      },
      {
        id: "2",
        remoteIp: "192.168.1.100",
        timestamp: "2023-01-02",
        webhookId: "w1",
        method: "POST",
        statusCode: 201,
        processingTime: 20,
        size: 200,
        headers: {},
        query: {},
        body: {},
        contentType: "application/json",
      },
      {
        id: "3",
        remoteIp: "10.0.0.5",
        timestamp: "2023-01-03",
        webhookId: "w1",
        method: "PUT",
        statusCode: 202,
        processingTime: 30,
        size: 300,
        headers: {},
        query: {},
        body: {},
        contentType: "application/json",
      },
    ]);

    beforeEach(async () => {
      // Reset DB before each test
      await resetDb();

      // Insert test data
      await logRepository.batchInsertLogs(items);
      createDatasetMock(items, { autoRegister: true });
    });

    it("should filter by exact IP match", async () => {
      req = createMockRequest({ query: { remoteIp: "192.168.1.5" } });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items.map((/** @type {LogEntry} */ i) => i.id)).toEqual([
        "1",
      ]);
    });

    it("should filter by CIDR range", async () => {
      // 192.168.1.0/24 should match 1 and 2
      req = createMockRequest({ query: { remoteIp: "192.168.1.0/24" } });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      expect(output.items.map((/** @type {LogEntry} */ i) => i.id)).toEqual(
        expect.arrayContaining(["1", "2"]),
      );
      expect(output.items).not.toContain(expect.objectContaining({ id: "3" }));
    });

    it("should handle invalid IP filter gracefully", async () => {
      req = createMockRequest({ query: { remoteIp: "invalid-ip" } });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      // Should match nothing if invalid IP logic returns false, or handle safely
      // matchesIp returns false for invalid strings -> empty list
      expect(output.items).toEqual([]);
    });
  });
});
