import { describe, test, expect } from "@jest/globals";
import { calculateRunDynamicMemory } from "@apify/actor-memory-expression";
import { createRequire } from "module";
import { assertType } from "../setup/helpers/test-utils.js";
import { constsMock } from "../setup/helpers/shared-mocks.js";

const require = createRequire(import.meta.url);
const actorJson = require("../../.actor/actor.json");

const expression = actorJson.defaultMemoryMbytes;

describe("Actor Memory Expression", () => {
  test("should use default 512MB when input is empty", async () => {
    const memory = await calculateRunDynamicMemory(
      expression,
      assertType({
        input: {},
      }),
    );
    // Formula: max(512, 256 + (3 * 32) + (10MB * 4)) = max(512, 256 + 96 + 40) = max(512, 392) = 512
    expect(memory).toBe(512);
  });

  test("should scale up with large urlCount", async () => {
    const memory = await calculateRunDynamicMemory(
      expression,
      assertType({
        input: { urlCount: 20 },
      }),
    );
    // Formula: max(512, 256 + (20 * 32) + (10MB * 4)) = max(512, 256 + 640 + 40) = 936
    // Platform rounds to power of 2: 1024
    expect(memory).toBe(1024);
  });

  test("should scale up with large maxPayloadSize", async () => {
    const memory = await calculateRunDynamicMemory(
      expression,
      assertType({
        input: { maxPayloadSize: 100 * 1024 * 1024 }, // 100MB
      }),
    );
    // Formula: max(512, 256 + (3 * 32) + (100 * 4)) = max(512, 256 + 96 + 400) = 752
    // Rationale: maxPayloadSize is in bytes, normalized to MB in expression (/ 1048576)
    // 256 + 96 + 400 = 752. Power of 2: 1024
    expect(memory).toBe(1024);
  });

  test("should respect useFixedMemory toggle with default value", async () => {
    const memory = await calculateRunDynamicMemory(
      expression,
      assertType({
        input: { useFixedMemory: true },
      }),
    );
    // Should be default fixed: 2048
    expect(memory).toBe(constsMock.DEFAULT_FIXED_MEMORY_MBYTES);
  });

  test("should respect manual fixedMemoryMbytes override", async () => {
    const memory = await calculateRunDynamicMemory(
      expression,
      assertType({
        input: { useFixedMemory: true, fixedMemoryMbytes: 4096 },
      }),
    );
    expect(memory).toBe(4096);
  });

  test("should handle platform rounding for manual values", async () => {
    const memory = await calculateRunDynamicMemory(
      expression,
      assertType({
        input: { useFixedMemory: true, fixedMemoryMbytes: 3000 },
      }),
    );
    // Rounds to 4096
    expect(memory).toBe(4096);
  });
});
