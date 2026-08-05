#!/usr/bin/env node
/**
 * @file scripts/run-perf-gate.mjs
 * @description Cross-platform wrapper for PERF_RUN release-gate scenarios.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const scenarioArg = process.argv.find((arg) => arg.startsWith("--scenario="));
const scenario = scenarioArg ? scenarioArg.split("=")[1] : "no-custom-script";

const jestBin = join(repoRoot, "node_modules", "jest", "bin", "jest.js");

const child = spawn(
  process.execPath,
  [
    "--experimental-vm-modules",
    "--max-old-space-size=8192",
    jestBin,
    "--runInBand",
    "--detectOpenHandles",
    "tests/e2e/perf.release-gate.test.js",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PERF_RUN: "1",
      PERF_SCENARIO: scenario,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
