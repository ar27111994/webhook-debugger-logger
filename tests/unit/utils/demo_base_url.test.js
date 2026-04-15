/**
 * @file tests/unit/utils/demo_base_url.test.js
 * @description Unit tests for local-only demo base URL selection.
 */

import { jest } from "@jest/globals";
import {
  DEFAULT_BASE_URL,
  DEFAULT_DEMO_TARGET,
  DEMO_TARGET_BASE_URLS,
  DEMO_TARGET_ENV_VAR,
  resolveDemoBaseUrl,
} from "../../../src/utils/demo_base_url.js";

describe("Demo base URL resolver", () => {
  it("should return the default base URL when no target is provided", () => {
    expect(resolveDemoBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
  });

  it("should return the default base URL for blank input", () => {
    expect(resolveDemoBaseUrl("   ")).toBe(DEFAULT_BASE_URL);
  });

  it("should map supported target names to hardcoded local URLs", () => {
    expect(resolveDemoBaseUrl("localhost")).toBe(
      DEMO_TARGET_BASE_URLS.localhost,
    );
    expect(resolveDemoBaseUrl("ipv4")).toBe(DEMO_TARGET_BASE_URLS.ipv4);
    expect(resolveDemoBaseUrl("ipv6")).toBe(DEMO_TARGET_BASE_URLS.ipv6);
  });

  it("should normalize case and surrounding whitespace before matching", () => {
    expect(resolveDemoBaseUrl("  IPV4 ")).toBe(DEMO_TARGET_BASE_URLS.ipv4);
  });

  it("should warn and fall back for unsupported selectors", () => {
    const warn = jest.fn();

    expect(resolveDemoBaseUrl("http://localhost:8080", warn)).toBe(
      DEFAULT_BASE_URL,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(DEMO_TARGET_ENV_VAR),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(DEFAULT_DEMO_TARGET),
    );
  });
});
