/**
 * @file tests/unit/utils/storage_helper.test.js
 * @description Unit tests for storage utilities.
 */

import { jest } from "@jest/globals";
import { STORAGE_CONSTS } from "../../../src/consts/storage.js";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import { apifyMock } from "../../setup/helpers/shared-mocks.js";
import { assertType } from "../../setup/helpers/test-utils.js";
import { MIME_TYPES } from "../../../src/consts/http.js";
import { APP_CONSTS } from "../../../src/consts/app.js";

// Mock dependencies
const mockNanoid = jest.fn(() => "mock-id");
jest.unstable_mockModule("nanoid", () => ({ nanoid: mockNanoid }));

// Setup shared mocks (includes apify)
await setupCommonMocks({ apify: true });

// Import module under test
const { generateKvsKey, offloadToKvs, getKvsUrl, createReferenceBody } =
  await import("../../../src/utils/storage_helper.js");

describe("Storage Helper Utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset defaults
    mockNanoid.mockReturnValue("mock-id");
    apifyMock.openKeyValueStore.mockResolvedValue({
      setValue: jest.fn(),
      getPublicUrl: assertType(
        jest.fn(
          () =>
            "https://api.apify.com/v2/key-value-stores/default/records/mock-key",
        ),
      ),
      getValue: jest.fn(),
    });
  });

  describe("generateKvsKey", () => {
    it("should generate a key with the correct prefix and id", () => {
      const key = generateKvsKey();
      expect(key).toBe(`${STORAGE_CONSTS.KVS_KEY_PREFIX}mock-id`);
      expect(mockNanoid).toHaveBeenCalled();
    });
  });

  describe("offloadToKvs", () => {
    it("should offload content to the key value store", async () => {
      const key = "test-key";
      const value = "some-content";
      const contentType = MIME_TYPES.TEXT;

      const mockSetValue = jest.fn();
      apifyMock.openKeyValueStore.mockResolvedValueOnce(
        assertType({
          setValue: mockSetValue,
        }),
      );

      await offloadToKvs(key, value, contentType);

      expect(apifyMock.openKeyValueStore).toHaveBeenCalled();
      expect(mockSetValue).toHaveBeenCalledWith(key, value, { contentType });
    });
  });

  describe("getKvsUrl", () => {
    it("should return public URL from KV store", async () => {
      const key = "test-key";
      const url = await getKvsUrl(key);
      expect(url).toBe(
        "https://api.apify.com/v2/key-value-stores/default/records/mock-key",
      );
    });

    it("should fallback if openKeyValueStore fails", async () => {
      apifyMock.openKeyValueStore.mockRejectedValueOnce(new Error("KVS Error"));
      const key = "test-key";

      const url = await getKvsUrl(key);

      expect(url).toBe(STORAGE_CONSTS.KVS_URL_FALLBACK(key));
    });

    it("should fallback if getPublicUrl is not a function", async () => {
      apifyMock.openKeyValueStore.mockResolvedValueOnce(assertType({})); // No getPublicUrl method
      const key = "test-key";

      const url = await getKvsUrl(key);

      expect(url).toBe(STORAGE_CONSTS.KVS_URL_FALLBACK(key));
    });
  });

  describe("createReferenceBody", () => {
    it("should create a correctly formatted reference object", () => {
      const key = "test-key";
      const kvsUrl = "http://example.com/item";
      const originalSize = APP_CONSTS.BYTES_PER_KB;
      const opts = {
        key,
        kvsUrl,
        originalSize,
      };

      const result = createReferenceBody(opts);

      expect(result).toEqual({
        data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
        key,
        note: STORAGE_CONSTS.DEFAULT_OFFLOAD_NOTE,
        originalSize,
        kvsUrl,
      });
    });

    it("should allow overriding defaults", () => {
      const key = "test-key";
      const kvsUrl = "http://example.com/item";
      const originalSize = 500;
      const note = "Custom Note";
      const data = "CUSTOM_MARKER";
      const opts = {
        key,
        kvsUrl,
        originalSize,
        note,
        data,
      };

      const result = createReferenceBody(opts);

      expect(result).toEqual({
        data,
        key,
        note,
        originalSize,
        kvsUrl,
      });
    });
  });

  describe("Error Propagation Edge Cases", () => {
    const ERROR_RATE_LIMIT = "Rate limited";
    const ERROR_PAYLOAD_LARGE = "Payload too large";

    it("should propagate errors if offloadToKvs fails to open KVS", async () => {
      const error = new Error(ERROR_RATE_LIMIT);
      apifyMock.openKeyValueStore.mockRejectedValueOnce(assertType(error));
      await expect(offloadToKvs("key", "val", MIME_TYPES.TEXT)).rejects.toThrow(
        ERROR_RATE_LIMIT,
      );
    });

    it("should propagate errors if store.setValue fails", async () => {
      const mockSetValue = assertType(jest.fn());
      mockSetValue.mockRejectedValueOnce(new Error(ERROR_PAYLOAD_LARGE));
      apifyMock.openKeyValueStore.mockResolvedValueOnce(
        assertType({
          setValue: mockSetValue,
        }),
      );

      await expect(offloadToKvs("key", "val", MIME_TYPES.TEXT)).rejects.toThrow(
        ERROR_PAYLOAD_LARGE,
      );
      expect(mockSetValue).toHaveBeenCalled();
    });
  });

  describe("Security and Sanitation Checks", () => {
    it("should escape the fallback Actor.getValue hint for keys with quotes and control characters", async () => {
      apifyMock.openKeyValueStore.mockRejectedValueOnce(
        assertType(new Error("KVS Error")),
      );
      const maliciousKey = `test'"\\\n$&$$key`;
      const url = await getKvsUrl(maliciousKey);

      expect(url).toContain(maliciousKey);
      expect(url).toContain(`Actor.getValue(${JSON.stringify(maliciousKey)})`);
    });

    it("should handle extremely large sizes and negative sizes in createReferenceBody", () => {
      const largeSize = Number.MAX_SAFE_INTEGER;
      const ref1 = createReferenceBody({
        key: "k1",
        kvsUrl: "u1",
        originalSize: largeSize,
      });
      expect(ref1.originalSize).toBe(largeSize);

      const ref2 = createReferenceBody({
        key: "k1",
        kvsUrl: "u1",
        originalSize: -1,
      });
      expect(ref2.originalSize).toBe(-1); // Types allow numbers, doesn't validate bounds natively
    });
  });

  describe("Concurrency and Stress Limits", () => {
    it("should handle generating 10,000 keys rapidly without collision and in reasonable time", () => {
      // Provide a pseudo-random implementation for the nanoid mock just for this test
      let counter = 0;
      mockNanoid.mockImplementation(() => `random-${counter++}`);

      const start = Date.now();
      const keys = new Set();
      const count = 10000;
      for (let i = 0; i < count; i++) {
        keys.add(generateKvsKey());
      }
      const duration = Date.now() - start;

      expect(keys.size).toBe(count); // No collisions
      // 10K keys should be virtually instantaneous (< 100ms usually, setting safe threshold)
      const durationThresholdMs = 500;
      expect(duration).toBeLessThan(durationThresholdMs);

      // Re-mock nanoid for other tests
      mockNanoid.mockReturnValue("mock-id");
    });

    it("should handle offloading 100 concurrent payloads cleanly", async () => {
      const concurrentCount = 100;
      const mockSetValue = assertType(jest.fn());
      mockSetValue.mockResolvedValue(undefined);
      apifyMock.openKeyValueStore.mockResolvedValue(
        assertType({
          setValue: mockSetValue,
        }),
      );

      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        offloadToKvs(`key_${i}`, `val_${i}`, MIME_TYPES.TEXT),
      );
      await Promise.all(promises);

      expect(mockSetValue).toHaveBeenCalledTimes(concurrentCount);
    });
  });
});
