/**
 * @file tests/unit/scripts/check_coverage.test.js
 * @description Unit tests for scripts/check-coverage.mjs.
 */

import { jest } from "@jest/globals";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  asObject,
  findRuleThresholds,
  isMainModule,
  main,
  parseArgs,
  runChecks,
} from "../../../scripts/check-coverage.mjs";

const SRC_MAIN = "src/main.js";
const REPO_ROOT = "/workspace/repo";
const TWO_CALLS = 2;
const ARG_SUMMARY = "--summary";
const ARG_THRESHOLDS = "--thresholds";
const ARG_LABEL = "--label";

describe("check-coverage script", () => {
  describe("parseArgs", () => {
    it("returns defaults when no args provided", () => {
      expect(parseArgs([])).toEqual({
        summaryPath: "coverage/coverage-summary.json",
        thresholdsPath: ".github/coverage/source-matrix.thresholds.json",
        label: "coverage-check",
      });
    });

    it("parses known arguments and ignores unknown tokens", () => {
      expect(
        parseArgs([
          "--unknown",
          "foo",
          ARG_SUMMARY,
          "a.json",
          ARG_THRESHOLDS,
          "b.json",
          ARG_LABEL,
          "matrix",
        ]),
      ).toEqual({
        summaryPath: "a.json",
        thresholdsPath: "b.json",
        label: "matrix",
      });
    });
  });

  describe("asObject", () => {
    it("returns object values", () => {
      const input = { ok: true };
      expect(asObject(input)).toEqual(input);
    });

    it("returns empty object for non-object values", () => {
      expect(asObject(null)).toEqual({});
      expect(asObject("x")).toEqual({});
      expect(asObject(1)).toEqual({});
      expect(asObject([])).toEqual({});
    });
  });

  describe("findRuleThresholds", () => {
    const rules = [
      {
        type: "exact",
        pattern: SRC_MAIN,
        thresholds: { lines: 100 },
      },
      {
        type: "prefix",
        pattern: "src/routes/",
        thresholds: { lines: 90 },
      },
      {
        type: "includes",
        pattern: "scripts/",
        thresholds: { lines: 95 },
      },
      {
        pattern: "src/default/",
        thresholds: { lines: 80 },
      },
    ];

    it("matches exact rule", () => {
      expect(findRuleThresholds(SRC_MAIN, rules)).toEqual({ lines: 100 });
    });

    it("matches prefix rule", () => {
      expect(findRuleThresholds("src/routes/logs.js", rules)).toEqual({
        lines: 90,
      });
    });

    it("matches includes rule", () => {
      expect(findRuleThresholds("some/path/scripts/job.js", rules)).toEqual({
        lines: 95,
      });
    });

    it("uses default type prefix when type is omitted", () => {
      expect(findRuleThresholds("src/default/file.js", rules)).toEqual({
        lines: 80,
      });
    });

    it("returns null when no rule matches", () => {
      expect(findRuleThresholds("other/file.js", rules)).toBeNull();
    });
  });

  describe("runChecks", () => {
    /** @returns {{ writes: string[], stream: { write: (chunk: string) => boolean } }} */
    const makeWriter = () => {
      /** @type {string[]} */
      const writes = [];
      return {
        writes,
        stream: {
          write: /** @type {(chunk: string) => boolean} */ (
            jest.fn((chunk) => {
              writes.push(String(chunk));
              return true;
            })
          ),
        },
      };
    };

    it("passes and writes success output", () => {
      const stdout = makeWriter();
      const stderr = makeWriter();
      const exit = jest.fn();

      const summary = {
        total: {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
        "src/main.js": {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
      };

      const thresholds = {
        global: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        rules: [
          {
            type: "exact",
            pattern: SRC_MAIN,
            thresholds: {
              lines: 100,
              statements: 100,
              functions: 100,
              branches: 100,
            },
          },
        ],
      };

      const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(REPO_ROOT);
      runChecks(summary, thresholds, "ok", {
        stdout: stdout.stream,
        stderr: stderr.stream,
        exit,
      });
      cwdSpy.mockRestore();

      expect(exit).not.toHaveBeenCalled();
      expect(stdout.writes.join("\n")).toContain("[ok] Coverage gate passed.");
      expect(stderr.writes).toHaveLength(0);
    });

    it("normalizes absolute paths under cwd to workspace-relative paths", () => {
      const stdout = makeWriter();
      const stderr = makeWriter();
      const exit = jest.fn();

      const summary = {
        total: {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
        [`${REPO_ROOT}/${SRC_MAIN}`]: {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
      };

      const thresholds = {
        global: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        rules: [
          {
            type: "exact",
            pattern: SRC_MAIN,
            thresholds: {
              lines: 100,
              statements: 100,
              functions: 100,
              branches: 100,
            },
          },
        ],
      };

      const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(REPO_ROOT);
      runChecks(summary, thresholds, "cwd-rel", {
        stdout: stdout.stream,
        stderr: stderr.stream,
        exit,
      });
      cwdSpy.mockRestore();

      expect(exit).not.toHaveBeenCalled();
      expect(stdout.writes.join("\n")).toContain(
        "[cwd-rel] Coverage gate passed.",
      );
      expect(stderr.writes).toHaveLength(0);
    });

    it("normalizes Windows-style absolute paths that use single backslashes", () => {
      const stdout = makeWriter();
      const stderr = makeWriter();
      const exit = jest.fn();

      const summary = {
        total: {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
        "C:\\workspace\\repo\\src\\main.js": {
          lines: { total: 10, pct: 100 },
          statements: { total: 10, pct: 100 },
          functions: { total: 10, pct: 100 },
          branches: { total: 10, pct: 100 },
        },
      };

      const thresholds = {
        global: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        rules: [
          {
            type: "exact",
            pattern: SRC_MAIN,
            thresholds: {
              lines: 100,
              statements: 100,
              functions: 100,
              branches: 100,
            },
          },
        ],
      };

      const cwdSpy = jest
        .spyOn(process, "cwd")
        .mockReturnValue("C:\\workspace\\repo");
      runChecks(summary, thresholds, "windows-rel", {
        stdout: stdout.stream,
        stderr: stderr.stream,
        exit,
      });
      cwdSpy.mockRestore();

      expect(exit).not.toHaveBeenCalled();
      expect(stdout.writes.join("\n")).toContain(
        "[windows-rel] Coverage gate passed.",
      );
      expect(stderr.writes).toHaveLength(0);
    });

    it("fails and writes failure output", () => {
      const stdout = makeWriter();
      const stderr = makeWriter();
      const exit = jest.fn();

      const summary = {
        total: {
          lines: { pct: 90 },
          statements: { pct: 90 },
          functions: { pct: 90 },
          branches: { pct: 90 },
        },
        "C:/tmp/repo/src/main.js": {
          lines: { total: 10, pct: 80 },
          statements: { total: 10, pct: 80 },
          functions: { total: 10, pct: 80 },
          branches: { total: 10, pct: 80 },
        },
      };

      const thresholds = {
        global: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        rules: [
          {
            type: "exact",
            pattern: SRC_MAIN,
            thresholds: {
              lines: 100,
              statements: 100,
              functions: 100,
              branches: 100,
            },
          },
        ],
      };

      runChecks(summary, thresholds, "failed", {
        stdout: stdout.stream,
        stderr: stderr.stream,
        exit,
      });

      expect(exit).toHaveBeenCalledWith(1);
      const joinedErr = stderr.writes.join("\n");
      expect(joinedErr).toContain("[failed] Coverage gate failed");
      expect(joinedErr).toContain("global.lines");
      expect(joinedErr).toContain("src/main.js.lines");
      expect(stdout.writes).toHaveLength(0);
    });

    it("skips non-finite thresholds and missing local rules safely", () => {
      const stdout = makeWriter();
      const stderr = makeWriter();
      const exit = jest.fn();

      const summary = {
        total: {},
        "src/no-rule.js": {},
        "src/with-rule.js": {},
      };

      const thresholds = {
        global: {
          lines: "not-a-number",
          statements: undefined,
          functions: null,
          branches: {},
        },
        rules: [
          {
            type: "exact",
            pattern: "src/with-rule.js",
            thresholds: {
              lines: "skip",
              statements: "skip",
              functions: "skip",
              branches: "skip",
            },
          },
        ],
      };

      runChecks(summary, thresholds, "skip-paths", {
        stdout: stdout.stream,
        stderr: stderr.stream,
        exit,
      });

      expect(exit).not.toHaveBeenCalled();
      expect(stdout.writes.join("\n")).toContain(
        "[skip-paths] Coverage gate passed.",
      );
      expect(stderr.writes).toHaveLength(0);
    });

    it("uses default io and rules fallback when io is omitted", () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      const summary = {
        total: {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
      };

      const thresholds = {
        global: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        rules: "not-an-array",
      };

      runChecks(summary, thresholds, "default-io");

      expect(stdoutSpy).toHaveBeenCalledWith(
        "[default-io] Coverage gate passed.\n",
      );
      stdoutSpy.mockRestore();
    });

    it("uses pct fallback for missing local metric values", () => {
      const stdout = makeWriter();
      const stderr = makeWriter();
      const exit = jest.fn();

      const summary = {
        total: {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
        [SRC_MAIN]: {
          lines: { total: 1 },
          statements: { total: 1 },
          functions: { total: 1 },
          branches: { total: 1 },
        },
      };

      const thresholds = {
        global: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        rules: [
          {
            type: "exact",
            pattern: SRC_MAIN,
            thresholds: {
              lines: 100,
              statements: 100,
              functions: 100,
              branches: 100,
            },
          },
        ],
      };

      runChecks(summary, thresholds, "missing-local-pct", {
        stdout: stdout.stream,
        stderr: stderr.stream,
        exit,
      });

      expect(exit).toHaveBeenCalledWith(1);
      expect(stderr.writes.join("\n")).toContain(
        `${SRC_MAIN}.lines: 0.00 < 100.00`,
      );
      expect(stdout.writes).toHaveLength(0);
    });

    it("passes when local metric totals are non-zero and meet thresholds", () => {
      const stdout = makeWriter();
      const stderr = makeWriter();
      const exit = jest.fn();

      const summary = {
        total: {
          lines: { pct: 100 },
          statements: { pct: 100 },
          functions: { pct: 100 },
          branches: { pct: 100 },
        },
        [SRC_MAIN]: {
          lines: { total: 10, pct: 100 },
          statements: { total: 10, pct: 100 },
          functions: { total: 10, pct: 100 },
          branches: { total: 10, pct: 100 },
        },
      };

      const thresholds = {
        global: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        rules: [
          {
            type: "exact",
            pattern: SRC_MAIN,
            thresholds: {
              lines: 100,
              statements: 100,
              functions: 100,
              branches: 100,
            },
          },
        ],
      };

      runChecks(summary, thresholds, "local-nonzero-pass", {
        stdout: stdout.stream,
        stderr: stderr.stream,
        exit,
      });

      expect(exit).not.toHaveBeenCalled();
      expect(stdout.writes.join("\n")).toContain(
        "[local-nonzero-pass] Coverage gate passed.",
      );
      expect(stderr.writes).toHaveLength(0);
    });
  });

  describe("main", () => {
    it("reads and checks coverage summary + thresholds", () => {
      const readFileSyncFn =
        /** @type {(path: string, encoding: string) => string} */ (
          jest
            .fn()
            .mockReturnValueOnce(
              JSON.stringify({
                total: {
                  lines: { pct: 100 },
                  statements: { pct: 100 },
                  functions: { pct: 100 },
                  branches: { pct: 100 },
                },
                [SRC_MAIN]: {
                  lines: { pct: 100 },
                  statements: { pct: 100 },
                  functions: { pct: 100 },
                  branches: { pct: 100 },
                },
              }),
            )
            .mockReturnValueOnce(
              JSON.stringify({
                global: {
                  lines: 100,
                  statements: 100,
                  functions: 100,
                  branches: 100,
                },
                rules: [
                  {
                    type: "exact",
                    pattern: SRC_MAIN,
                    thresholds: {
                      lines: 100,
                      statements: 100,
                      functions: 100,
                      branches: 100,
                    },
                  },
                ],
              }),
            )
        );

      const stdout = { write: jest.fn(() => true) };
      const stderr = { write: jest.fn(() => true) };
      const exit = jest.fn();
      const resolveFn = jest.fn((...parts) => parts.join("/"));

      main([ARG_SUMMARY, "a.json", ARG_THRESHOLDS, "b.json", ARG_LABEL, "z"], {
        readFileSyncFn,
        resolveFn,
        cwd: "/repo",
        stdout,
        stderr,
        exit,
      });

      expect(resolveFn).toHaveBeenCalledWith("/repo", "a.json");
      expect(resolveFn).toHaveBeenCalledWith("/repo", "b.json");
      expect(readFileSyncFn).toHaveBeenCalledTimes(TWO_CALLS);
      expect(stdout.write).toHaveBeenCalledWith("[z] Coverage gate passed.\n");
      expect(exit).not.toHaveBeenCalled();
    });
  });

  describe("isMainModule", () => {
    it("returns true when argv entry resolves to current module", () => {
      const scriptUrl = new URL(
        "../../../scripts/check-coverage.mjs",
        import.meta.url,
      ).href;
      const scriptPath = fileURLToPath(scriptUrl);
      expect(isMainModule(scriptUrl, scriptPath)).toBe(true);
    });

    it("returns false when argv entry is missing or different", () => {
      expect(isMainModule(import.meta.url, "")).toBe(false);
      expect(isMainModule(import.meta.url, "/workspace/other.mjs")).toBe(false);
    });
  });

  describe("module main guard", () => {
    it("executes main() when module is the CLI entry", async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "check-coverage-"));
      const summaryPath = join(tempRoot, "summary.json");
      const thresholdsPath = join(tempRoot, "thresholds.json");

      writeFileSync(
        summaryPath,
        JSON.stringify({
          total: {
            lines: { pct: 100 },
            statements: { pct: 100 },
            functions: { pct: 100 },
            branches: { pct: 100 },
          },
          [SRC_MAIN]: {
            lines: { pct: 100 },
            statements: { pct: 100 },
            functions: { pct: 100 },
            branches: { pct: 100 },
          },
        }),
      );

      writeFileSync(
        thresholdsPath,
        JSON.stringify({
          global: {
            lines: 100,
            statements: 100,
            functions: 100,
            branches: 100,
          },
          rules: [
            {
              type: "exact",
              pattern: SRC_MAIN,
              thresholds: {
                lines: 100,
                statements: 100,
                functions: 100,
                branches: 100,
              },
            },
          ],
        }),
      );

      const originalArgv = process.argv;
      const scriptPath = fileURLToPath(
        new URL("../../../scripts/check-coverage.mjs", import.meta.url),
      );

      process.argv = [
        originalArgv[0],
        scriptPath,
        ARG_SUMMARY,
        summaryPath,
        ARG_THRESHOLDS,
        thresholdsPath,
        ARG_LABEL,
        "cli-path",
      ];

      const stdoutSpy = jest
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);
      const stderrSpy = jest
        .spyOn(process.stderr, "write")
        .mockReturnValue(true);

      await import(`../../../scripts/check-coverage.mjs?cli=${Date.now()}`);

      expect(stdoutSpy).toHaveBeenCalledWith(
        "[cli-path] Coverage gate passed.\n",
      );
      expect(stderrSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      process.argv = originalArgv;
    });
  });
});
