/**
 * Constant Discovery Utilities.
 *
 * These are used in tests to provide common functionality for discovering constant modules.
 *
 * @module tests/setup/helpers/constant-discovery
 */

import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * Discovers all constant modules in src/consts.
 * Uses child_process to bypass fs mocks that might be active in the test environment.
 * @returns {string[]} List of constant module filenames
 */
export function discoverConstantModules() {
  const constsDir = join(process.cwd(), "src", "consts");

  try {
    // Use ls to list files, bypassing any active fs mocks
    // eslint-disable-next-line sonarjs/os-command
    const output = execSync(`ls "${constsDir}"`).toString();
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
