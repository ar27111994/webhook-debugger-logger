/**
 * Constant Discovery Utilities.
 *
 * These are used in tests to provide common functionality for discovering constant modules.
 *
 * @module tests/setup/helpers/constant-discovery
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ENCODINGS } from "../../../src/consts/http.js";

/**
 * Discovers all constant modules in src/consts.
 * Uses child_process to bypass fs mocks that might be active in the test environment.
 * @returns {string[]} List of constant module filenames
 */
export function discoverConstantModules() {
  const constsDir = join(process.cwd(), "src", "consts");

  try {
    // Use a separate Node process so test-level fs mocks do not affect discovery.
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `const { readdirSync } = require("node:fs");
const dir = ${JSON.stringify(constsDir)};
for (const entry of readdirSync(dir, { withFileTypes: true })) {
  if (entry.isFile()) process.stdout.write(entry.name + "\\n");
}`,
      ],
      { encoding: ENCODINGS.UTF },
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((file) => file.endsWith(".js"));
  } catch (error) {
    throw new Error(
      `Failed to discover constant modules at ${constsDir}: ${/** @type {Error} */ (error).message}`,
    );
  }
}
