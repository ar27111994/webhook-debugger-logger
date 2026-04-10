/**
 * @file scripts/check-coverage.mjs
 * @description Enforces coverage thresholds from a JSON rules file against an Istanbul coverage-summary.json.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENCODINGS } from "../src/consts/http.js";

const METRICS = ["lines", "statements", "functions", "branches"];
const FRACTION_DIGITS = 2;

/**
 * @param {string[]} argv
 * @returns {{summaryPath: string, thresholdsPath: string, label: string}}
 */
export function parseArgs(argv) {
  /** @type {{summaryPath: string, thresholdsPath: string, label: string}} */
  const out = {
    summaryPath: "coverage/coverage-summary.json",
    thresholdsPath: ".github/coverage/source-matrix.thresholds.json",
    label: "coverage-check",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--summary" && argv[i + 1]) {
      out.summaryPath = argv[i + 1];
      i += 1;
    } else if (token === "--thresholds" && argv[i + 1]) {
      out.thresholdsPath = argv[i + 1];
      i += 1;
    } else if (token === "--label" && argv[i + 1]) {
      out.label = argv[i + 1];
      i += 1;
    }
  }

  return out;
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
export function asObject(value) {
  return value && typeof value === "object"
    ? /** @type {Record<string, any>} */ (value)
    : {};
}

/**
 * @param {string} filePath
 * @param {Array<{type?: string, pattern: string, thresholds: Record<string, number>}>} rules
 * @returns {Record<string, number> | null}
 */
export function findRuleThresholds(filePath, rules) {
  for (const rule of rules) {
    const type = rule.type || "prefix";
    if (type === "exact" && filePath === rule.pattern) return rule.thresholds;
    if (type === "prefix" && filePath.startsWith(rule.pattern))
      return rule.thresholds;
    if (type === "includes" && filePath.includes(rule.pattern))
      return rule.thresholds;
  }
  return null;
}

/**
 * @param {Record<string, any>} summary
 * @param {Record<string, any>} thresholds
 * @param {string} label
 * @param {{
 *   stdout?: { write: (chunk: string) => unknown },
 *   stderr?: { write: (chunk: string) => unknown },
 *   exit?: (code?: number) => unknown
 * }} [io]
 */
export function runChecks(summary, thresholds, label, io = {}) {
  const stderr = io.stderr || process.stderr;
  const stdout = io.stdout || process.stdout;
  const exit = io.exit || process.exit;
  const cwdNormalized = String(process.cwd()).replaceAll("\\", "/");

  const files = Object.entries(summary)
    .filter(([key]) => key !== "total")
    .map(([absPath, metrics]) => {
      const normalized = String(absPath).replaceAll("\\\\", "/");
      let rel = normalized;

      if (normalized.startsWith(`${cwdNormalized}/`)) {
        rel = normalized.slice(cwdNormalized.length + 1);
      } else {
        const srcMarker = "/src/";
        const srcIdx = normalized.indexOf(srcMarker);
        if (srcIdx >= 0)
          rel = `src/${normalized.slice(srcIdx + srcMarker.length)}`;
      }

      return { rel, metrics: asObject(metrics) };
    });

  const globalThresholds = asObject(thresholds.global);
  const rules =
    /** @type {Array<{type?: string, pattern: string, thresholds: Record<string, number>}>} */ (
      Array.isArray(thresholds.rules) ? thresholds.rules : []
    );

  /** @type {string[]} */
  const failures = [];

  for (const metric of METRICS) {
    const expected = Number(globalThresholds[metric]);
    if (Number.isFinite(expected)) {
      const actual = Number(asObject(summary.total)[metric]?.pct ?? 0);
      if (actual + Number.EPSILON < expected) {
        failures.push(
          `global.${metric}: ${actual.toFixed(FRACTION_DIGITS)} < ${expected.toFixed(FRACTION_DIGITS)}`,
        );
      }
    }
  }

  for (const file of files) {
    const localThresholds = findRuleThresholds(file.rel, rules);
    if (!localThresholds) continue;

    for (const metric of METRICS) {
      const expected = Number(localThresholds[metric]);
      if (!Number.isFinite(expected)) continue;
      const metricSummary = asObject(file.metrics)[metric];
      const total = Number(metricSummary?.total ?? 0);
      if (total === 0) continue;
      const actual = Number(metricSummary?.pct ?? 0);
      if (actual + Number.EPSILON < expected) {
        failures.push(
          `${file.rel}.${metric}: ${actual.toFixed(FRACTION_DIGITS)} < ${expected.toFixed(FRACTION_DIGITS)}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    stderr.write(
      `\n[${label}] Coverage gate failed with ${failures.length} issue(s):\n`,
    );
    for (const failure of failures) stderr.write(`- ${failure}\n`);
    exit(1);
    return;
  }

  stdout.write(`[${label}] Coverage gate passed.\n`);
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   readFileSyncFn?: (path: string, encoding: string) => string,
 *   resolveFn?: (...parts: string[]) => string,
 *   cwd?: string,
 *   stdout?: { write: (chunk: string) => unknown },
 *   stderr?: { write: (chunk: string) => unknown },
 *   exit?: (code?: number) => unknown
 * }} [deps]
 */
export function main(argv = process.argv.slice(1 + 1), deps = {}) {
  const args = parseArgs(argv);
  const readFileSyncFn = deps.readFileSyncFn || readFileSync;
  const resolveFn = deps.resolveFn || resolve;
  const cwd = deps.cwd || process.cwd();
  const io = {
    stdout: deps.stdout || process.stdout,
    stderr: deps.stderr || process.stderr,
    exit: deps.exit || process.exit,
  };

  const summaryPath = resolveFn(cwd, args.summaryPath);
  const thresholdsPath = resolveFn(cwd, args.thresholdsPath);

  const summary = JSON.parse(readFileSyncFn(summaryPath, ENCODINGS.UTF8));
  const thresholds = JSON.parse(readFileSyncFn(thresholdsPath, ENCODINGS.UTF8));

  runChecks(asObject(summary), asObject(thresholds), args.label, io);
}

/**
 * @param {string} [metaUrl]
 * @param {string | undefined} [argvEntry]
 * @returns {boolean}
 */
export function isMainModule(
  metaUrl = import.meta.url,
  argvEntry = process.argv[1],
) {
  if (!argvEntry) return false;
  return resolve(argvEntry) === fileURLToPath(metaUrl);
}

if (isMainModule()) {
  main();
}
