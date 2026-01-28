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

// Initialize mocks
await setupCommonMocks({ apify: true, axios: false });

const { createLogsHandler } = await import("../../src/routes/logs.js");

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 * @typedef {import("../../src/typedefs.js").WebhookEvent} WebhookEvent
 */

describe("Robust Sorting Logic", () => {
  useMockCleanup();

  /** @type {Request} */
  let req;
  /** @type {Response} */
  let res;
  /** @type {NextFunction} */
  let next;
  /** @type {RequestHandler} */
  let handler;

  /** @type {Partial<WebhookEvent>[]} */
  const largeDataset = Array.from({ length: 50 }, (_, i) => ({
    id: `item_${i}`,
    timestamp: new Date(Date.now() - i * 1000).toISOString(), // item_0 is newest
    size: (i % 5) * 100, // Varying sizes for sort
    webhookId: "w1",
  }));

  beforeEach(() => {
    createDatasetMock(largeDataset, { autoRegister: true });
    res = createMockResponse();
    next = createMockNextFunction();
    handler = createLogsHandler(assertType({ isValid: () => true }));
    jest.clearAllMocks();
  });

  describe("Native Sort (Timestamp DESC)", () => {
    it("should respect limit and offset efficiently", async () => {
      // Offset 10, Limit 5
      req = createMockRequest({
        query: {
          sort: "timestamp:desc",
          offset: "10",
          limit: "5",
        },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];

      // Should return items 10-14
      expect(output.items).toHaveLength(5);
      expect(output.items[0].id).toBe("item_10");
      expect(output.items[4].id).toBe("item_14");
      expect(output.nextOffset).toBe(15);
    });
  });

  describe("Non-Native Sort (Full Scan)", () => {
    it("should sort correctly by size DESC (requires buffering)", async () => {
      // Sizes: 0, 100, 200, 300, 400 ... repeating
      // Sort size:desc -> 400s first, then 300s...
      req = createMockRequest({
        query: {
          sort: "size:desc",
          limit: "5",
        },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];

      expect(output.items).toHaveLength(5);
      // All top items should have size 400
      output.items.forEach((/** @type {WebhookEvent} */ item) => {
        expect(item.size).toBe(400);
      });
    });

    it("should paginate sorted results correctly", async () => {
      // Sort size:asc -> 0s first.
      // 50 items total. 10 items have size 0.
      // Offset 5, Limit 5 -> Should return the second batch of size 0 items.
      req = createMockRequest({
        query: {
          sort: "size:asc",
          offset: "5",
          limit: "5",
        },
      });
      await handler(req, res, next);
      const output = jest.mocked(res.json).mock.calls[0][0];
      if (!output.items) console.error("Test Failure Output:", output);

      expect(output.items).toHaveLength(5);
      output.items.forEach((/** @type {WebhookEvent} */ item) => {
        expect(item.size).toBe(0);
      });
      // Verify IDs to ensure stable sort order or at least consistency
      // Original IDs with size 0: item_0, item_5, item_10 ...
      // Expected: item_25, item_30, item_35, item_40, item_45
      // Offset 5 skips 0,5,10,15,20.
      // Should return item_25...
      expect(output.items[0].id).toBe("item_25");
    });
  });
});
