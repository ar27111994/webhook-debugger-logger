/**
 * @file tests/unit/storage_helper.test.js
 * @description Unit tests for storage_helper utility to ensure 100% coverage.
 */
import { jest, describe, test, expect } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { assertType } from "../setup/helpers/test-utils.js";

// Mock Apify and Logger
await setupCommonMocks({ apify: true, logger: true });

const { getKvsUrl, offloadToKvs, createReferenceBody, generateKvsKey } =
  await import("../../src/utils/storage_helper.js");
const { Actor } = await import("apify");

describe("StorageHelper Coverage Tests", () => {
  useMockCleanup();

  test("generateKvsKey should return a string starting with payload_", () => {
    const key = generateKvsKey();
    expect(key).toMatch(/^payload_[a-zA-Z0-9_-]{10}$/);
  });

  test("offloadToKvs should call store.setValue", async () => {
    const mockStore = {
      setValue: jest.fn().mockResolvedValue(assertType(undefined)),
    };
    Actor.openKeyValueStore = assertType(
      jest.fn().mockResolvedValue(assertType(mockStore)),
    );

    await offloadToKvs("test-key", "test-value", "text/plain");

    expect(Actor.openKeyValueStore).toHaveBeenCalled();
    expect(mockStore.setValue).toHaveBeenCalledWith("test-key", "test-value", {
      contentType: "text/plain",
    });
  });

  describe("getKvsUrl", () => {
    test("should return public URL if getPublicUrl is present", async () => {
      const mockStore = {
        getPublicUrl: jest
          .fn()
          .mockReturnValue(
            "https://api.apify.com/v2/key-value-stores/default/records/key",
          ),
      };
      Actor.openKeyValueStore = assertType(
        jest.fn().mockResolvedValue(assertType(mockStore)),
      );

      const url = await getKvsUrl("key");
      expect(mockStore.getPublicUrl).toHaveBeenCalled();
      expect(url).toBe(
        "https://api.apify.com/v2/key-value-stores/default/records/key",
      );
    });

    test("should return fallback description if getPublicUrl is not a function", async () => {
      const mockStore = {
        // No getPublicUrl
      };
      Actor.openKeyValueStore = assertType(
        jest.fn().mockResolvedValue(assertType(mockStore)),
      );

      const url = await getKvsUrl("key");
      expect(url).toContain("Use Actor.getValue('key') to retrieve");
    });

    test("should return fallback description if openKeyValueStore throws", async () => {
      Actor.openKeyValueStore = assertType(
        jest.fn().mockRejectedValue(assertType(new Error("KVS Error"))),
      );

      const url = await getKvsUrl("key");
      expect(url).toContain("Use Actor.getValue('key') to retrieve");
    });
  });

  test("createReferenceBody should return standardized object", () => {
    const result = createReferenceBody({
      key: "k1",
      kvsUrl: "u1",
      originalSize: 100,
    });

    expect(result).toEqual({
      data: "[OFFLOADED_TO_KVS]",
      key: "k1",
      note: "Body too large for Dataset. Stored in KeyValueStore.",
      originalSize: 100,
      kvsUrl: "u1",
    });

    // Custom data/note
    const custom = createReferenceBody({
      key: "k2",
      kvsUrl: "u2",
      originalSize: 200,
      note: "custom note",
      data: "custom marker",
    });
    expect(custom.note).toBe("custom note");
    expect(custom.data).toBe("custom marker");
  });
});
