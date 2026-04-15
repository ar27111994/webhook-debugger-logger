/**
 * @file tests/unit/utils/custom_script_executor.test.js
 * @description Unit tests for custom script executor behavior using real worker isolates.
 */

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

describe("Custom Script Executor", () => {
  const CONCURRENT_EXECUTION_TEST_TIMEOUT_MS = 15000;
  const CONCURRENT_WORKER_SCRIPT_TIMEOUT_MS = 250;
  const CODE_GENERATION_BLOCKING_TEST_TIMEOUT_MS = 15000;

  beforeEach(() => {
    jest.resetModules();
  });

  describe("validateCustomScriptSource", () => {
    it("should return the original source for valid scripts", async () => {
      const { validateCustomScriptSource } =
        await import("../../../src/utils/custom_script_executor.js");

      const source = "event.accepted = true;";

      expect(validateCustomScriptSource(source)).toBe(source);
    });

    it("should reject invalid JavaScript syntax", async () => {
      const { validateCustomScriptSource } =
        await import("../../../src/utils/custom_script_executor.js");

      expect(() => validateCustomScriptSource("if (")).toThrow(
        "Unexpected end of input",
      );
    });
  });

  describe("executeCustomScript", () => {
    it("should execute scripts in an isolated worker without mutating caller-owned objects", async () => {
      const { executeCustomScript } =
        await import("../../../src/utils/custom_script_executor.js");

      const event = { nested: { value: 1 } };
      const req = { headers: { "x-test": "safe" }, requestId: "req-1" };

      const result = await executeCustomScript({
        source:
          "event.nested.value = 2; event.requestSeen = req.requestId; req.headers['x-test'] = 'changed';",
        event,
        req,
        timeoutMs: 50,
      });

      expect(result.ok).toBe(true);
      expect(result.event).toEqual(
        expect.objectContaining({
          nested: { value: 2 },
          requestSeen: "req-1",
        }),
      );
      expect(event).toEqual({ nested: { value: 1 } });
      expect(req).toEqual({
        headers: { "x-test": "safe" },
        requestId: "req-1",
      });
    });

    it("should serialize structured console output safely", async () => {
      const { executeCustomScript } =
        await import("../../../src/utils/custom_script_executor.js");

      const result = await executeCustomScript({
        source: "console.info('hello', { nested: true }, new Error('boom'));",
        event: {},
        req: {},
        timeoutMs: 250,
      });

      expect(result.ok).toBe(true);
      expect(result.logs).toEqual([
        {
          level: "info",
          args: [
            "hello",
            { nested: true },
            expect.objectContaining({
              name: "Error",
              message: "boom",
              stack: expect.any(String),
            }),
          ],
        },
      ]);
    });

    it(
      "should block eval and Function constructor code generation inside the worker isolate",
      async () => {
        const { executeCustomScript } =
          await import("../../../src/utils/custom_script_executor.js");

        const evalResult = await executeCustomScript({
          source:
            'try { eval("1+1"); } catch (error) { event.evalMessage = error.message; }',
          event: {},
          req: {},
          timeoutMs: 250,
        });
        const functionResult = await executeCustomScript({
          source:
            'try { Function("return 1")(); } catch (error) { event.functionMessage = error.message; }',
          event: {},
          req: {},
          timeoutMs: 250,
        });

        expect(evalResult.ok).toBe(true);
        expect(evalResult.event?.evalMessage).toContain(
          "Code generation from strings disallowed",
        );
        expect(functionResult.ok).toBe(true);
        expect(functionResult.event?.functionMessage).toContain(
          "Code generation from strings disallowed",
        );
      },
      CODE_GENERATION_BLOCKING_TEST_TIMEOUT_MS,
    );

    it("should surface runtime failures from the worker isolate", async () => {
      const { executeCustomScript } =
        await import("../../../src/utils/custom_script_executor.js");

      const result = await executeCustomScript({
        source: "throw new Error('runtime failure');",
        event: {},
        req: {},
        timeoutMs: 50,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toEqual(
        expect.objectContaining({
          name: "Error",
          message: "Error: runtime failure",
        }),
      );
    });

    it("should report busy-loop timeouts without hanging the caller", async () => {
      const { executeCustomScript } =
        await import("../../../src/utils/custom_script_executor.js");

      const result = await executeCustomScript({
        source: "while (true) {}",
        event: {},
        req: {},
        timeoutMs: 25,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toEqual(
        expect.objectContaining({
          name: "Error",
          message: expect.stringContaining("timed out"),
        }),
      );
    });

    it(
      "should handle concurrent executions without cross-talk between events",
      async () => {
        const { executeCustomScript } =
          await import("../../../src/utils/custom_script_executor.js");

        const executionCount = 6;
        const results = await Promise.all(
          Array.from({ length: executionCount }, (_, index) =>
            executeCustomScript({
              source:
                "event.requestSeen = req.requestId; event.counter = (event.counter ?? 0) + 1;",
              event: { counter: 0 },
              req: { requestId: `req-${index}` },
              timeoutMs: CONCURRENT_WORKER_SCRIPT_TIMEOUT_MS,
            }),
          ),
        );

        expect(results).toHaveLength(executionCount);
        expect(results.every((result) => result.ok)).toBe(true);
        expect(results.map((result) => result.event?.requestSeen)).toEqual(
          Array.from({ length: executionCount }, (_, index) => `req-${index}`),
        );
        expect(results.every((result) => result.event?.counter === 1)).toBe(
          true,
        );
      },
      CONCURRENT_EXECUTION_TEST_TIMEOUT_MS,
    );
  });
});
