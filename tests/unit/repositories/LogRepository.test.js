/**
 * @file tests/unit/repositories/LogRepository.test.js
 * @description Unit tests for LogRepository with live DuckDB integration.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import { resetDb } from "../../setup/helpers/db-hooks.js";
import {
  ENCODINGS,
  HTTP_HEADERS,
  HTTP_METHODS,
  HTTP_STATUS,
  HTTP_STATUS_MESSAGES,
  MIME_TYPES,
} from "../../../src/consts/http.js";
import {
  REQUEST_ID_PREFIX,
  SORT_DIRECTIONS,
  WEBHOOK_ID_PREFIX,
} from "../../../src/consts/app.js";
import { SIGNATURE_PROVIDERS } from "../../../src/consts/security.js";
import { assertType } from "../../setup/helpers/test-utils.js";
import { duckDbMock } from "../../setup/helpers/shared-mocks.js";
import { useMockCleanup } from "../../setup/helpers/test-lifecycle.js";

// We want to test LogRepository against the REAL duckdb.js (initialized to memory)
// so we don't mock it to ensure integration behavior for complex SQL.
await setupCommonMocks({
  logger: true,
  fs: true,
  consts: true,
  db: false, // Use real duckdb logic
});

// Import subject and DB utilities
const { logRepository } =
  await import("../../../src/repositories/LogRepository.js");
const realDuckDbModule = await import("../../../src/db/duckdb.js");
const { resetDbInstance, closeDb } = realDuckDbModule;
const { STORAGE_CONSTS } = await import("../../../src/consts/storage.js");

/**
 * @typedef {import("../../../src/typedefs.js").LogEntry} LogEntry
 * @typedef {Promise<import("../../../src/repositories/LogRepository.js").logRepository>} LogRepositoryPromise
 */

describe("LogRepository", () => {
  // Clear mocks after each test
  useMockCleanup(async () => {
    // Clear all tables for each test
    await resetDb();
  });

  beforeAll(async () => {
    // Ensure clean instance at start
    await resetDbInstance();
  });

  afterAll(async () => {
    await closeDb();
  });

  /**
   * @param {Partial<LogEntry>} overrides
   * @returns {LogEntry}
   */
  const mockLog = (overrides = {}) => ({
    id: "log_1",
    webhookId: `${WEBHOOK_ID_PREFIX}1`,
    timestamp: new Date().toISOString(),
    method: HTTP_METHODS.POST,
    statusCode: HTTP_STATUS.OK,
    size: 1024,
    // eslint-disable-next-line sonarjs/no-hardcoded-ip
    remoteIp: "1.2.3.4",
    userAgent: "Jest",
    requestUrl: "https://example.com/webhook",
    headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
    query: { ref: "test" },
    body: { data: "hello" },
    responseHeaders: { server: "cloudflare" },
    responseBody: { status: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK] },
    signatureValid: true,
    signatureProvider: SIGNATURE_PROVIDERS.GITHUB,
    signatureError: undefined,
    requestId: `${REQUEST_ID_PREFIX}1`,
    processingTime: 50,
    contentType: MIME_TYPES.JSON,
    bodyEncoding: ENCODINGS.UTF,
    sourceOffset: 123,
    ...overrides,
  });

  const duckDbModule = "../../../src/db/duckdb.js";

  /**
   * @param {Array<unknown>} responses
   * @returns {LogRepositoryPromise}
   */
  const importRepositoryWithMockedDbResponses = async (responses) => {
    const executeQuerySpy = jest.spyOn(duckDbMock, "executeQuery");
    executeQuerySpy.mockReset();

    for (const response of responses) {
      executeQuerySpy.mockResolvedValueOnce(assertType(response));
    }

    jest.resetModules();
    jest.unstable_mockModule(duckDbModule, () => duckDbMock);

    const importedModule =
      await import("../../../src/repositories/LogRepository.js");
    return importedModule.logRepository;
  };

  const restoreRealDuckDbModule = () => {
    jest.resetModules();
    jest.unstable_mockModule(duckDbModule, () => realDuckDbModule);
  };

  afterEach(() => {
    restoreRealDuckDbModule();
  });

  describe("insertLog", () => {
    it("should insert a single log and retrieve it by ID", async () => {
      const entry = mockLog({ id: "test_insert" });
      await logRepository.insertLog(entry);

      const result = await logRepository.getLogById(entry.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(entry.id);
      expect(result?.method).toBe(entry.method);
      expect(result?.headers).toEqual(entry.headers);
    });

    it("should insert a BARE log and handle ALL null-fallbacks in #mapLogToParams", async () => {
      /** @type {Partial<LogEntry>} */
      const bareEntry = {
        id: "bare_log",
        webhookId: `${WEBHOOK_ID_PREFIX}bare`,
        timestamp: new Date().toISOString(),
      };
      await logRepository.insertLog(assertType(bareEntry));

      const result = await logRepository.getLogById("bare_log");
      expect(result).toBeDefined();
      // Verify fallbacks worked (objects should be {}, not null/undefined from tryParse context)
      expect(result?.headers).toEqual({});
      expect(result?.body).toEqual({});
      expect(result?.remoteIp).toBeNull();
      expect(result?.signatureValid).toBe(false); // default fallback
    });

    it("should handle snake_case source_offset in #mapLogToParams", async () => {
      const entry = mockLog({
        id: "snake_case_offset",
      });
      // Override to use snake_case instead of camelCase to test fallback branch
      const sourceOffset = 456;
      Object.defineProperty(entry, "source_offset", {
        value: sourceOffset,
        writable: true,
        configurable: true,
      });
      // intentional test of snake_case fallback
      delete entry.sourceOffset;
      await logRepository.insertLog(entry);

      const result = await logRepository.getLogById("snake_case_offset");
      expect(result).toBeDefined();
      expect(result?.sourceOffset).toBe(sourceOffset);
    });

    it("should handle signatureValidation object in #mapLogToParams", async () => {
      const entry = mockLog({
        id: "sig_obj_log",
        signatureValidation: {
          valid: true,
          provider: SIGNATURE_PROVIDERS.CUSTOM,
          error: "none",
        },
      });
      await logRepository.insertLog(entry);

      const result = await logRepository.getLogById("sig_obj_log");
      expect(result?.signatureValid).toBe(true);
      expect(result?.signatureProvider).toBe(SIGNATURE_PROVIDERS.CUSTOM);
      expect(result?.signatureError).toBe("none");
    });

    it("should handle ON CONFLICT by updating source_offset", async () => {
      const entry1 = mockLog({ id: "conflict_log", sourceOffset: 100 });
      await logRepository.insertLog(entry1);

      const entry2 = mockLog({ id: "conflict_log", sourceOffset: 200 });
      await logRepository.insertLog(entry2);

      const result = await logRepository.getLogById("conflict_log");
      expect(result?.sourceOffset).toBe(entry2.sourceOffset);
    });
  });

  describe("batchInsertLogs", () => {
    it("should insert multiple logs in a transaction", async () => {
      const logs = [
        mockLog({ id: "batch_1" }),
        mockLog({ id: "batch_2" }),
        mockLog({ id: "batch_3" }),
      ];

      await logRepository.batchInsertLogs(logs);

      const { items, total } = await logRepository.findLogs({ limit: 10 });
      expect(total).toBe(logs.length);
      expect(items.length).toBe(logs.length);
    });

    it("should handle empty batch", async () => {
      await expect(logRepository.batchInsertLogs([])).resolves.not.toThrow();
    });
  });

  describe("findLogs - Complex Filtering", () => {
    beforeEach(async () => {
      await logRepository.batchInsertLogs([
        mockLog({
          id: "log_a",
          timestamp: "2026-01-01T12:00:00Z",
          statusCode: HTTP_STATUS.OK,
          method: HTTP_METHODS.POST,
          // eslint-disable-next-line sonarjs/no-hardcoded-ip
          remoteIp: "1.1.1.1",
          requestUrl: "https://a.com",
          requestId: `${REQUEST_ID_PREFIX}a`,
          contentType: MIME_TYPES.JSON,
          signatureValid: true,
          signatureProvider: SIGNATURE_PROVIDERS.GITHUB,
          webhookId: `${WEBHOOK_ID_PREFIX}a`,
        }),
        mockLog({
          id: "log_b",
          timestamp: "2026-01-01T13:00:00Z",
          statusCode: HTTP_STATUS.NOT_FOUND,
          method: HTTP_METHODS.GET,
          // eslint-disable-next-line sonarjs/no-hardcoded-ip
          remoteIp: "2.2.2.2",
          requestUrl: "https://b.com",
          requestId: `${REQUEST_ID_PREFIX}b`,
          contentType: MIME_TYPES.TEXT,
          signatureValid: false,
          signatureError: "invalid_sig",
          signatureProvider: SIGNATURE_PROVIDERS.SHOPIFY,
          webhookId: `${WEBHOOK_ID_PREFIX}b`,
        }),
        mockLog({
          id: "log_c",
          timestamp: "2026-01-01T14:00:00Z",
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          method: HTTP_METHODS.POST,
          remoteIp: "127.0.0.1",
          requestUrl: "https://c.com",
          webhookId: `${WEBHOOK_ID_PREFIX}a`,
          signatureProvider: SIGNATURE_PROVIDERS.STRIPE,
        }),
      ]);
    });

    it("should filter by search term (ID or URL)", async () => {
      let searchTerm = "log_a";
      const result = await logRepository.findLogs({ search: searchTerm });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe(searchTerm);

      searchTerm = "b.com";
      const resultUrl = await logRepository.findLogs({ search: searchTerm });
      expect(resultUrl.total).toBe(1);
      expect(resultUrl.items[0].id).toBe("log_b");
    });

    it("should filter by requestUrl", async () => {
      const result = await logRepository.findLogs({ requestUrl: "a.com" });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_a");
    });

    it("should filter by method", async () => {
      const result = await logRepository.findLogs({
        method: HTTP_METHODS.POST,
      });
      const expectedIds = ["log_a", "log_c"];
      expect(result.total).toBe(expectedIds.length);
      expect(result.items.map((item) => item.id)).toEqual(
        expect.arrayContaining(expectedIds),
      );
    });

    it("should filter by statusCode (Value or Array)", async () => {
      const result = await logRepository.findLogs({
        statusCode: HTTP_STATUS.NOT_FOUND,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_b");

      const resultRange = await logRepository.findLogs({
        statusCode: [{ operator: "gte", value: HTTP_STATUS.NOT_FOUND }],
      });
      const expectedIds = ["log_b", "log_c"];
      expect(resultRange.total).toBe(expectedIds.length);
      expect(resultRange.items.map((item) => item.id)).toEqual(
        expect.arrayContaining(expectedIds),
      );
    });

    it("should filter by webhookId", async () => {
      const result = await logRepository.findLogs({
        webhookId: `${WEBHOOK_ID_PREFIX}b`,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_b");
    });

    it("should filter by requestId", async () => {
      const result = await logRepository.findLogs({
        requestId: `${REQUEST_ID_PREFIX}b`,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_b");
    });

    it("should filter by CIDR range", async () => {
      // eslint-disable-next-line sonarjs/no-hardcoded-ip
      const result = await logRepository.findLogs({ remoteIp: "1.1.0.0/16" });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_a");
    });

    it("should filter by specific IP", async () => {
      const result = await logRepository.findLogs({ remoteIp: "127.0.0.1" });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_c");
    });

    it("should filter by userAgent", async () => {
      const result = await logRepository.findLogs({ userAgent: "Jest" });
      const expectedIds = ["log_a", "log_b", "log_c"];
      expect(result.total).toBe(expectedIds.length);
      expect(result.items.map((item) => item.id)).toEqual(
        expect.arrayContaining(expectedIds),
      );
    });

    it("should filter by contentType", async () => {
      const result = await logRepository.findLogs({ contentType: "plain" });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_b");
    });

    it("should filter by signature validation state", async () => {
      const resultTrue = await logRepository.findLogs({
        signatureValid: "true",
      });
      const expectedIds = ["log_a", "log_c"];
      expect(resultTrue.total).toBe(expectedIds.length);

      const resultFalse = await logRepository.findLogs({
        signatureValid: false,
      });
      expect(resultFalse.total).toBe(1);
      expect(resultFalse.items[0].id).toBe("log_b");
    });

    it("should filter by signature provider", async () => {
      const result = await logRepository.findLogs({
        signatureProvider: SIGNATURE_PROVIDERS.SHOPIFY,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_b");
    });

    it("should filter by signature error", async () => {
      const result = await logRepository.findLogs({
        signatureError: "invalid",
      });
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe("log_b");
    });

    it("should handle pagination", async () => {
      const resultDefault = await logRepository.findLogs({});
      const expectedIds = ["log_a", "log_b", "log_c"];
      expect(resultDefault.total).toBe(expectedIds.length);
      expect(resultDefault.items.map((item) => item.id)).toEqual(
        expect.arrayContaining(expectedIds),
      );

      const result = await logRepository.findLogs({ limit: 1, offset: 1 });
      expect(result.total).toBe(expectedIds.length);
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe("log_b");
    });

    it("should sanitize invalid pagination values to safe defaults", async () => {
      const result = await logRepository.findLogs({ limit: -10, offset: -4 });
      const EXPECTED_TOTAL = 3;
      expect(result.total).toBe(EXPECTED_TOTAL);
      expect(result.items.length).toBeGreaterThan(0);
      // Negative offset should be clamped to default offset (0), which returns newest record first.
      expect(result.items[0].id).toBe("log_c");
    });

    it("should sort logs", async () => {
      const result = await logRepository.findLogs({
        sort: [{ field: "statusCode", dir: SORT_DIRECTIONS.ASC }],
      });
      expect(result.items[0].statusCode).toBe(HTTP_STATUS.OK);
      expect(result.items[2].statusCode).toBe(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    });

    it("should fallback to default sort for invalid fields", async () => {
      const result = await logRepository.findLogs({
        sort: [{ field: "invalid_field", dir: SORT_DIRECTIONS.ASC }],
      });
      // Defaults to timestamp DESC
      expect(
        new Date(result.items[0].timestamp).getTime(),
      ).toBeGreaterThanOrEqual(new Date(result.items[1].timestamp).getTime());
    });

    it("should handle invalid range/json rules in #addRange and #addJsonFilter", async () => {
      // rules not an array in #addRange
      const resultRange = await logRepository.findLogs({
        statusCode: "not-an-array",
      });
      const expectedIds = ["log_a", "log_b", "log_c"];
      expect(resultRange.total).toBe(expectedIds.length);
      expect(resultRange.items.map((item) => item.id)).toEqual(
        expect.arrayContaining(expectedIds),
      );

      // rules null/undefined in #addJsonFilter
      const resultJson = await logRepository.findLogs({
        headers: assertType(null),
      });
      expect(resultJson.total).toBe(expectedIds.length);
      expect(resultJson.items.map((item) => item.id)).toEqual(
        expect.arrayContaining(expectedIds),
      );
    });
  });

  describe("getLogById with fields", () => {
    it("should return only requested fields and clean up missing ones", async () => {
      await logRepository.insertLog(
        mockLog({ id: "field_test", statusCode: HTTP_STATUS.ACCEPTED }),
      );

      const result = await logRepository.getLogById("field_test", [
        "id",
        "statusCode",
      ]);
      expect(result).toBeDefined();
      expect(result?.id).toBe("field_test");
      expect(result?.statusCode).toBe(HTTP_STATUS.ACCEPTED);
      expect(result).not.toHaveProperty("method");
      expect(result).not.toHaveProperty("headers");
    });

    it("should fallback to full select when only invalid fields are requested", async () => {
      await logRepository.insertLog(
        mockLog({
          id: "field_invalid_only",
          statusCode: HTTP_STATUS.NO_CONTENT,
        }),
      );

      const result = await logRepository.getLogById("field_invalid_only", [
        "__invalid_field__",
      ]);

      expect(result).toBeDefined();
      expect(result?.id).toBe("field_invalid_only");
      expect(result?.method).toBe(HTTP_METHODS.POST);
    });
  });

  describe("JSON and Range Filtering", () => {
    beforeEach(async () => {
      await logRepository.insertLog(
        mockLog({
          id: "json_log",
          headers: { "x-custom": "value-123", "x-type": "test" },
          body: { user: { name: "John" }, secret: "password123" },
          size: 5000,
          processingTime: 1500,
        }),
      );
    });

    it("should filter by multiple JSON values", async () => {
      const result = await logRepository.findLogs({
        headers: { "x-custom": "value-123", "x-type": "test" },
      });
      expect(result.total).toBe(1);
    });

    it("should filter by string in JSON column", async () => {
      const result = await logRepository.findLogs({
        headers: "value-123",
      });
      expect(result.total).toBe(1);
    });

    it("should filter by range conditions (size, processingTime, timestamp)", async () => {
      const resultSize = await logRepository.findLogs({
        size: [{ operator: "gt", value: 1000 }],
      });
      expect(resultSize.total).toBe(1);

      const resultTime = await logRepository.findLogs({
        processingTime: [{ operator: "lt", value: 2000 }],
      });
      expect(resultTime.total).toBe(1);

      const resultTs = await logRepository.findLogs({
        timestamp: [{ operator: "lte", value: new Date().toISOString() }],
      });
      expect(resultTs.total).toBe(1);
    });

    it("should ignore invalid object keys (coverage for regex filter)", async () => {
      const result = await logRepository.findLogs({
        headers: { $: "val" },
      });
      expect(result.total).toBe(1);
    });

    it("should skip null/undefined JSON values and safely handle numeric JSON values", async () => {
      const resultNumeric = await logRepository.findLogs({
        headers: {
          "x-custom": 123,
          skipNull: null,
          skipUndefined: undefined,
        },
      });

      // Numeric values are safely coerced to strings and can match stringified payload content.
      expect(resultNumeric.total).toBe(1);
      expect(resultNumeric.items[0].id).toBe("json_log");

      const resultNullUndefined = await logRepository.findLogs({
        headers: {
          "x-custom": "value-123",
          skipNull: null,
          skipUndefined: undefined,
        },
      });
      expect(resultNullUndefined.total).toBe(1);
      expect(resultNullUndefined.items[0].id).toBe("json_log");

      const resultMismatch = await logRepository.findLogs({
        headers: {
          "x-custom": "value-456",
          skipNull: null,
          skipUndefined: undefined,
        },
      });
      expect(resultMismatch.total).toBe(0);
      expect(resultMismatch.items[0]).toBeUndefined();
    });
  });

  describe("findOffloadedPayloads", () => {
    it("should find payloads with markers", async () => {
      await logRepository.insertLog(
        mockLog({
          id: "offloaded_sync",
          body: { data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC, key: "sync_key_1" },
        }),
      );
      await logRepository.insertLog(
        mockLog({
          id: "offloaded_stream",
          body: {
            data: STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
            key: "stream_key_2",
          },
        }),
      );
      await logRepository.insertLog(
        mockLog({
          id: "not_offloaded",
          body: { data: "normal" },
        }),
      );

      const result = await logRepository.findOffloadedPayloads(
        `${WEBHOOK_ID_PREFIX}1`,
      );
      const expectedIds = ["offloaded_sync", "offloaded_stream"];
      expect(result).toHaveLength(expectedIds.length);
      expect(result.map((r) => r.key)).toContain("sync_key_1");
      expect(result.map((r) => r.key)).toContain("stream_key_2");
    });

    it("should handle corrupted JSON in findOffloadedPayloads", async () => {
      await logRepository.insertLog(
        mockLog({
          id: "bad_json",
          body: { data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC },
        }),
      );
      const result = await logRepository.findOffloadedPayloads(
        `${WEBHOOK_ID_PREFIX}1`,
      );
      expect(result.find((r) => r.key === undefined)).toBeUndefined();
    });
  });

  describe("Cursor-based Pagination", () => {
    const totalLogs = 5;
    const year = 2026;
    const month = 0;
    const day = 10;

    beforeEach(async () => {
      for (let i = 1; i <= totalLogs; i++) {
        await logRepository.insertLog(
          mockLog({
            id: `cursor_${i}`,
            timestamp: new Date(year, month, day - i).toISOString(),
          }),
        );
      }
    });

    it("should return nextCursor if more items exist and handle default limits", async () => {
      const resultDefault = await logRepository.findLogsCursor({});
      expect(resultDefault.items).toHaveLength(totalLogs);

      const limit = 2;
      const result = await logRepository.findLogsCursor({ limit });
      expect(result.items).toHaveLength(limit);
      expect(result.nextCursor).toBeDefined();

      const nextPage = await logRepository.findLogsCursor({
        limit,
        cursor: assertType(result.nextCursor),
      });
      expect(nextPage.items).toHaveLength(limit);
      expect(nextPage.items[0].id).not.toBe(result.items[0].id);
    });

    it("should handle invalid cursor gracefully", async () => {
      const limit = 2;
      const result = await logRepository.findLogsCursor({
        limit,
        cursor: "invalid-base64-garbage",
      });
      expect(result.items).toHaveLength(limit);
    });

    it("should handle incomplete cursor gracefully", async () => {
      const limit = 2;
      const incomplete = Buffer.from(":").toString(ENCODINGS.BASE64);
      const result = await logRepository.findLogsCursor({
        limit,
        cursor: incomplete,
      });
      expect(result.items).toHaveLength(limit);

      const onlyTs = Buffer.from("2026-01-01T00:00:00.000Z:").toString(
        ENCODINGS.BASE64,
      );
      const resultTs = await logRepository.findLogsCursor({
        limit,
        cursor: onlyTs,
      });
      expect(resultTs.items).toHaveLength(limit);
    });

    it("should handle empty result set for cursor", async () => {
      const limit = 2;
      const result = await logRepository.findLogsCursor({
        method: "NON-EXISTENT",
        limit,
      });
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("should sanitize invalid cursor limit values", async () => {
      const result = await logRepository.findLogsCursor({
        limit: -5,
      });
      expect(result.items.length).toBeGreaterThan(0);
      // Default cursor ordering should remain timestamp DESC.
      expect(result.items[0].id).toBe("cursor_1");
    });

    it("should clamp cursor limit to max page limit for very large values", async () => {
      const EXPECTED_ITEMS = totalLogs;
      const result = await logRepository.findLogsCursor({
        limit: Number.MAX_SAFE_INTEGER,
      });
      // We inserted 5 records for this block; clamping should still return all 5.
      expect(result.items).toHaveLength(EXPECTED_ITEMS);
    });
  });

  describe("Log Mapping Branches (#mapRowToEntry)", () => {
    it("should hit integer signatureValid branch and handle NULL as empty objects", async () => {
      await logRepository.insertLog(
        mockLog(
          assertType({
            id: "mapping_branch_log",
            signatureValid: 1,
            headers: null,
            query: null,
            body: null,
            responseHeaders: null,
            responseBody: null,
          }),
        ),
      );

      const log = await logRepository.getLogById("mapping_branch_log");
      expect(log).toBeDefined();
      expect(log?.signatureValid).toBe(true);
      expect(log?.headers).toEqual({});
      expect(log?.query).toEqual({});
    });
  });

  describe("deleteLogsByWebhookId", () => {
    it("should delete only logs for specified webhook", async () => {
      await logRepository.insertLog(
        mockLog({ id: "wh1_log", webhookId: "wh1" }),
      );
      await logRepository.insertLog(
        mockLog({ id: "wh2_log", webhookId: "wh2" }),
      );

      await logRepository.deleteLogsByWebhookId("wh1");

      const result1 = await logRepository.getLogById("wh1_log");
      const result2 = await logRepository.getLogById("wh2_log");

      expect(result1).toBeNull();
      expect(result2).not.toBeNull();
    });
  });

  describe("parseTimestamp", () => {
    it("should parse Date object", () => {
      const d = new Date();
      expect(logRepository.parseTimestamp(d)).toBe(d.toISOString());
    });

    it("should parse number", () => {
      const now = Date.now();
      expect(logRepository.parseTimestamp(now)).toBe(
        new Date(now).toISOString(),
      );
    });

    it("should return current ISO string for null or invalid", () => {
      expect(logRepository.parseTimestamp(assertType(null))).toBeDefined();
      const result = logRepository.parseTimestamp("invalid");
      expect(new Date(result).getTime()).not.toBeNaN();
    });

    it("should handle unexpected types in parseTimestamp by returning current ISO", () => {
      const result = logRepository.parseTimestamp(assertType(Symbol("foo")));
      expect(new Date(result).getTime()).not.toBeNaN();
    });
  });

  describe("#buildOrderBy edge cases", () => {
    const totalItems = 2;

    beforeEach(async () => {
      await logRepository.insertLog(
        mockLog({
          id: "sort_test_1",
          statusCode: HTTP_STATUS.OK,
          timestamp: "2026-01-01T00:00:00Z",
        }),
      );
      await logRepository.insertLog(
        mockLog({
          id: "sort_test_2",
          statusCode: HTTP_STATUS.CREATED,
          timestamp: "2026-01-02T00:00:00Z",
        }),
      );
    });

    it("should use DESC when sort direction is not ASC", async () => {
      const result = await logRepository.findLogs({
        sort: [{ field: "timestamp", dir: SORT_DIRECTIONS.DESC }],
        limit: 10,
      });
      expect(result.items).toHaveLength(totalItems);
      // Verify ordering is DESC (newest first)
      const timestamps = result.items.map((item) =>
        new Date(item.timestamp).getTime(),
      );
      expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
    });

    it("should use ASC when sort direction is invalid/unknown", async () => {
      // Unknown direction should fall through to ASC
      const result = await logRepository.findLogs({
        sort: [{ field: "timestamp", dir: "invalid_dir" }],
        limit: 10,
      });
      expect(result.items).toHaveLength(totalItems);
      // Verify ordering is ASC (oldest first)
      const timestamps = result.items.map((item) =>
        new Date(item.timestamp).getTime(),
      );
      expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]);
    });

    it("should use ASC when sort direction is null", async () => {
      // null direction should fall through to ASC
      const result = await logRepository.findLogs({
        sort: [{ field: "timestamp", dir: null }],
        limit: 10,
      });
      expect(result.items).toHaveLength(totalItems);
      // Verify ordering is ASC (oldest first)
      const timestamps = result.items.map((item) =>
        new Date(item.timestamp).getTime(),
      );
      expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]);
    });
  });

  describe("Coverage: #addRange with invalid operator", () => {
    beforeEach(async () => {
      await logRepository.insertLog(
        mockLog({ id: "range_test", statusCode: HTTP_STATUS.OK, size: 100 }),
      );
    });

    it("should ignore conditions with invalid operators not in OPERATOR_MAP", async () => {
      // Pass an operator that doesn't exist in OPERATOR_MAP
      const result = await logRepository.findLogs({
        size: [{ operator: "invalid_op", value: 50 }],
      });
      // Should return all logs since the invalid operator is ignored
      expect(result.items.length).toBeGreaterThan(0);
    });

    it("should ignore conditions with empty operator string", async () => {
      const result = await logRepository.findLogs({
        size: [{ operator: "", value: 50 }],
      });
      // Empty string operator is also not in the map
      expect(result.items.length).toBeGreaterThan(0);
    });
  });

  describe("Coverage: #fixBigInts null handling", () => {
    it("should handle getLogById returning valid data", async () => {
      // Insert a log first to have data
      await logRepository.insertLog(
        mockLog({ id: "bigint_test", statusCode: HTTP_STATUS.OK }),
      );

      // Call getLogById which internally uses #fixBigInts
      const result = await logRepository.getLogById("bigint_test");

      // Verify the result is valid
      expect(result).toBeDefined();
      expect(result?.id).toBe("bigint_test");
    });

    it("should return null when getLogById receives a malformed row", async () => {
      const mockedRepository = await importRepositoryWithMockedDbResponses([
        [null],
      ]);

      const result = await mockedRepository.getLogById("malformed_row_test");

      expect(result).toBeNull();
    });

    it("should handle malformed list rows from executeQuery without throwing", async () => {
      const countRow = { total: 1 };
      const mockedRepository = await importRepositoryWithMockedDbResponses([
        [countRow],
        [null],
      ]);

      const result = await mockedRepository.findLogs({
        search: "null_handling_test",
        limit: 1,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(0);
    });
  });

  describe("Coverage: findLogs count query edge cases", () => {
    afterEach(async () => {
      jest.resetModules();
      jest.unstable_mockModule(
        duckDbModule,
        async () => import("../../../src/db/duckdb.js"),
      );
    });

    it("should return zero when count query returns a row without total", async () => {
      const countRowWithoutTotal = { count: 1 };
      const listRow = mockLog({
        id: "count_missing_total_test",
        statusCode: HTTP_STATUS.OK,
      });
      const mockedRepository = await importRepositoryWithMockedDbResponses([
        [countRowWithoutTotal],
        [listRow],
      ]);

      const result = await mockedRepository.findLogs({
        limit: 10,
      });

      expect(typeof result.total).toBe("number");
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(listRow.id);
    });

    it("should preserve null webhookId when a row contains a falsy webhookId", async () => {
      await logRepository.insertLog(
        mockLog({
          id: "falsy_webhook_test",
          webhookId: "",
          statusCode: HTTP_STATUS.OK,
        }),
      );

      const result = await logRepository.findLogs({
        search: "falsy_webhook_test",
        limit: 1,
      });

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      const firstItem = result.items[0];
      expect(firstItem).toBeDefined();
      expect(firstItem).not.toBeNull();
      expect(firstItem.webhookId ?? null).toBeNull();
    });

    it("should use zero when count total is explicitly null", async () => {
      const mockedRepository = await importRepositoryWithMockedDbResponses([
        [{ total: null }],
        [],
      ]);

      const result = await mockedRepository.findLogs({
        webhookId: "missing-webhook-id",
        limit: 10,
      });

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it("should use zero when count query returns no rows", async () => {
      const mockedRepository = await importRepositoryWithMockedDbResponses([
        [],
        [],
      ]);

      const result = await mockedRepository.findLogs({
        webhookId: "count-empty-row-set",
        limit: 10,
      });

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe("Coverage: findOffloadedPayloads error handling", () => {
    it("should return empty array when no offloaded payloads exist", async () => {
      // Query for a webhookId that has no offloaded payloads
      const result = await logRepository.findOffloadedPayloads(
        `${WEBHOOK_ID_PREFIX}nonexistent`,
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });
});
