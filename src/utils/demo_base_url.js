/**
 * @file src/utils/demo_base_url.js
 * @description Local-only base URL selection for the demo CLI.
 * @module utils/demo_base_url
 */

export const DEMO_TARGET_BASE_URLS = Object.freeze({
  // Local demo targets intentionally use loopback HTTP only.
  localhost: "http://localhost:8080",
  ipv4: "http://127.0.0.1:8080",
  // eslint-disable-next-line sonarjs/no-clear-text-protocols
  ipv6: "http://[::1]:8080",
});

/** @typedef {keyof typeof DEMO_TARGET_BASE_URLS} DemoTarget */

export const DEFAULT_DEMO_TARGET = "localhost";
export const DEFAULT_BASE_URL = DEMO_TARGET_BASE_URLS[DEFAULT_DEMO_TARGET];
export const DEMO_TARGET_ENV_VAR = "DEMO_TARGET";

const SUPPORTED_DEMO_TARGETS = Object.freeze(
  /** @type {DemoTarget[]} */ (Object.keys(DEMO_TARGET_BASE_URLS)),
);

/**
 * Resolve a demo base URL from a finite local target selector so the CLI only
 * ever talks to hardcoded loopback origins.
 *
 * @param {string | undefined} rawTarget
 * @param {(message: string) => void} [warn]
 * @returns {string}
 */
export function resolveDemoBaseUrl(rawTarget, warn = console.warn) {
  const normalizedTarget = String(rawTarget ?? "")
    .trim()
    .toLowerCase();

  if (!normalizedTarget) {
    return DEFAULT_BASE_URL;
  }

  if (Object.hasOwn(DEMO_TARGET_BASE_URLS, normalizedTarget)) {
    return DEMO_TARGET_BASE_URLS[/** @type {DemoTarget} */ (normalizedTarget)];
  }

  warn(
    `[WARN] Ignoring unsupported ${DEMO_TARGET_ENV_VAR} value "${normalizedTarget}". ` +
      `Supported values: ${SUPPORTED_DEMO_TARGETS.join(", ")}. Falling back to ` +
      `${DEFAULT_DEMO_TARGET} (${DEFAULT_BASE_URL}).`,
  );
  return DEFAULT_BASE_URL;
}
