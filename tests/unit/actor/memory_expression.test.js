/**
 * @file tests/unit/actor/memory_expression.test.js
 * @description Unit tests for the actor memory expression logic.
 */

import { describe, test, expect } from "@jest/globals";
import { calculateRunDynamicMemory } from "@apify/actor-memory-expression";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const actorJson = require("../../../.actor/actor.json");

const expression = actorJson.defaultMemoryMbytes;

const DEFAULT_ACTOR_MEMORY = 512;
const ACTOR_MEMORY_SCALED = 1024;
const ACTOR_MEMORY_HIGH = 2048;
const ACTOR_MEMORY_MIN_PLATFORM = 128;
const BYTES_IN_MB = 1048576;
const LOWER_DYNAMIC_CUTOVER_BELOW = 13;
const LOWER_DYNAMIC_CUTOVER_AT = 14;
const UPPER_DYNAMIC_CUTOVER_BELOW = 36;
const UPPER_DYNAMIC_CUTOVER_AT = 37;
const LOWER_PAYLOAD_CUTOVER_BELOW_MB = 93;
const LOWER_PAYLOAD_CUTOVER_AT_MB = 94;
const UPPER_PAYLOAD_CUTOVER_BELOW_MB = 274;
const UPPER_PAYLOAD_CUTOVER_AT_MB = 275;
const SAMPLE_FIXED_VALUES_FOR_POWER_OF_TWO_ASSERTION = [
  1,
  ACTOR_MEMORY_MIN_PLATFORM - 1,
  ACTOR_MEMORY_MIN_PLATFORM,
  ACTOR_MEMORY_SCALED - 1,
  ACTOR_MEMORY_SCALED,
  ACTOR_MEMORY_SCALED + 1,
  ACTOR_MEMORY_HIGH - 1,
  ACTOR_MEMORY_HIGH,
  ACTOR_MEMORY_HIGH + 1,
  ACTOR_MEMORY_HIGH + ACTOR_MEMORY_HIGH - 1,
];
const SAMPLE_DYNAMIC_URL_COUNT = 10;

/**
 * @param {number} value
 * @returns {boolean}
 */
function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

describe("Actor Memory Expression", () => {
  test("should use default 512MB when input is empty", async () => {
    const memory = await calculateRunDynamicMemory(expression, {
      input: {},
      runOptions: {},
    });
    // Formula: max(512, 256 + (3 * 32) + (10MB * 4)) = max(512, 256 + 96 + 40) = max(512, 392) = 512
    expect(memory).toBe(DEFAULT_ACTOR_MEMORY);
  });

  test("should scale up with large urlCount", async () => {
    const memory = await calculateRunDynamicMemory(expression, {
      input: { urlCount: 20 },
      runOptions: {},
    });
    // Formula: max(512, 256 + (20 * 32) + (10MB * 4)) = max(512, 256 + 640 + 40) = 936
    // Platform rounds to power of 2: 1024
    expect(memory).toBe(ACTOR_MEMORY_SCALED);
  });

  test("should scale up with large maxPayloadSize", async () => {
    const maxPayloadSize = 100; // 100MB
    const memory = await calculateRunDynamicMemory(expression, {
      input: { maxPayloadSize: maxPayloadSize * BYTES_IN_MB },
      runOptions: {},
    });
    // Formula: max(512, 256 + (3 * 32) + (100 * 4)) = max(512, 256 + 96 + 400) = 752
    // Rationale: maxPayloadSize is in bytes, normalized to MB in expression (/ 1048576)
    // 256 + 96 + 400 = 752. Power of 2: 1024
    expect(memory).toBe(ACTOR_MEMORY_SCALED);
  });

  test("should respect useFixedMemory toggle with default value", async () => {
    const expectedMemory = 2048;
    const memory = await calculateRunDynamicMemory(expression, {
      input: { useFixedMemory: true },
      runOptions: {},
    });
    // Should be default fixed: 2048
    expect(memory).toBe(expectedMemory);
  });

  test("should respect manual fixedMemoryMbytes override", async () => {
    const fixedMemory = 4096;
    const memory = await calculateRunDynamicMemory(expression, {
      input: { useFixedMemory: true, fixedMemoryMbytes: fixedMemory },
      runOptions: {},
    });
    expect(memory).toBe(fixedMemory);
  });

  test("should handle platform rounding for manual values", async () => {
    const expectedMemory = 4096;
    const memory = await calculateRunDynamicMemory(expression, {
      input: { useFixedMemory: true, fixedMemoryMbytes: 3000 },
      runOptions: {},
    });
    // Rounds to 4096
    expect(memory).toBe(expectedMemory);
  });

  test("should keep dynamic branch when fixedMemoryMbytes is provided but useFixedMemory is false", async () => {
    const memory = await calculateRunDynamicMemory(expression, {
      input: { useFixedMemory: false, fixedMemoryMbytes: 8192 },
      runOptions: {},
    });

    expect(memory).toBe(DEFAULT_ACTOR_MEMORY);
  });

  test("should round very small positive fixed memory to platform minimum", async () => {
    const memory = await calculateRunDynamicMemory(expression, {
      input: { useFixedMemory: true, fixedMemoryMbytes: 1 },
      runOptions: {},
    });

    expect(memory).toBe(ACTOR_MEMORY_MIN_PLATFORM);
  });

  test("should throw for non-positive fixed memory values", async () => {
    await expect(
      calculateRunDynamicMemory(expression, {
        input: { useFixedMemory: true, fixedMemoryMbytes: 0 },
        runOptions: {},
      }),
    ).rejects.toThrow("positive number");

    await expect(
      calculateRunDynamicMemory(expression, {
        input: { useFixedMemory: true, fixedMemoryMbytes: -1 },
        runOptions: {},
      }),
    ).rejects.toThrow("positive number");
  });

  test("should throw for non-numeric fixed memory values", async () => {
    await expect(
      calculateRunDynamicMemory(expression, {
        input: { useFixedMemory: true, fixedMemoryMbytes: "bad" },
        runOptions: {},
      }),
    ).rejects.toThrow("not a valid number");
  });

  test("should switch from 512 to 1024 at the lower dynamic cutover", async () => {
    const belowCutover = await calculateRunDynamicMemory(expression, {
      input: { urlCount: LOWER_DYNAMIC_CUTOVER_BELOW },
      runOptions: {},
    });
    const atCutover = await calculateRunDynamicMemory(expression, {
      input: { urlCount: LOWER_DYNAMIC_CUTOVER_AT },
      runOptions: {},
    });

    expect(belowCutover).toBe(DEFAULT_ACTOR_MEMORY);
    expect(atCutover).toBe(ACTOR_MEMORY_SCALED);
  });

  test("should switch from 1024 to 2048 at the upper dynamic cutover", async () => {
    const belowCutover = await calculateRunDynamicMemory(expression, {
      input: { urlCount: UPPER_DYNAMIC_CUTOVER_BELOW },
      runOptions: {},
    });
    const atCutover = await calculateRunDynamicMemory(expression, {
      input: { urlCount: UPPER_DYNAMIC_CUTOVER_AT },
      runOptions: {},
    });

    expect(belowCutover).toBe(ACTOR_MEMORY_SCALED);
    expect(atCutover).toBe(ACTOR_MEMORY_HIGH);
  });

  test("should switch from 512 to 1024 at the lower payload cutover", async () => {
    const belowCutover = await calculateRunDynamicMemory(expression, {
      input: { maxPayloadSize: LOWER_PAYLOAD_CUTOVER_BELOW_MB * BYTES_IN_MB },
      runOptions: {},
    });
    const atCutover = await calculateRunDynamicMemory(expression, {
      input: { maxPayloadSize: LOWER_PAYLOAD_CUTOVER_AT_MB * BYTES_IN_MB },
      runOptions: {},
    });

    expect(belowCutover).toBe(DEFAULT_ACTOR_MEMORY);
    expect(atCutover).toBe(ACTOR_MEMORY_SCALED);
  });

  test("should switch from 1024 to 2048 at the upper payload cutover", async () => {
    const belowCutover = await calculateRunDynamicMemory(expression, {
      input: { maxPayloadSize: UPPER_PAYLOAD_CUTOVER_BELOW_MB * BYTES_IN_MB },
      runOptions: {},
    });
    const atCutover = await calculateRunDynamicMemory(expression, {
      input: { maxPayloadSize: UPPER_PAYLOAD_CUTOVER_AT_MB * BYTES_IN_MB },
      runOptions: {},
    });

    expect(belowCutover).toBe(ACTOR_MEMORY_SCALED);
    expect(atCutover).toBe(ACTOR_MEMORY_HIGH);
  });

  test("should always round positive fixed memory values to a power of two", async () => {
    for (const fixedMemoryMbytes of SAMPLE_FIXED_VALUES_FOR_POWER_OF_TWO_ASSERTION) {
      const memory = await calculateRunDynamicMemory(expression, {
        input: { useFixedMemory: true, fixedMemoryMbytes },
        runOptions: {},
      });

      expect(isPowerOfTwo(memory)).toBe(true);
    }
  });

  test("should never go below dynamic minimum when fixed mode is disabled", async () => {
    const sampleDynamicInputs = [
      {},
      { useFixedMemory: false },
      { urlCount: 0, maxPayloadSize: 0 },
      { urlCount: 1, maxPayloadSize: BYTES_IN_MB },
      {
        urlCount: SAMPLE_DYNAMIC_URL_COUNT,
        maxPayloadSize: SAMPLE_DYNAMIC_URL_COUNT * BYTES_IN_MB,
      },
    ];

    for (const input of sampleDynamicInputs) {
      const memory = await calculateRunDynamicMemory(expression, {
        input,
        runOptions: {},
      });

      expect(memory).toBeGreaterThanOrEqual(DEFAULT_ACTOR_MEMORY);
    }
  });
});
