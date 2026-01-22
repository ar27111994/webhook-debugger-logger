import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { dnsPromisesMock } from "./helpers/shared-mocks.js";

// Mock dns/promises
jest.unstable_mockModule("dns/promises", () => ({
  default: dnsPromisesMock,
  resolve4: dnsPromisesMock.resolve4,
  resolve6: dnsPromisesMock.resolve6,
}));

// Import utils after mocking
// SSRF_INTERNAL_ERRORS is NOT exported by ssrf.js, it is imported from consts.js
// We must import it from consts.js directly for the test.
const { checkIpInRanges, validateUrlForSsrf, SSRF_ERRORS } =
  await import("../src/utils/ssrf.js");
const { SSRF_INTERNAL_ERRORS } = await import("../src/consts.js");

describe("SSRF Coverage Tests", () => {
  describe("checkIpInRanges", () => {
    test("should return false for empty/null IP", () => {
      expect(checkIpInRanges("", [])).toBe(false);
      expect(checkIpInRanges("", [])).toBe(false);
    });

    test("should handle invalid IPs gracefully", () => {
      expect(checkIpInRanges("invalid-ip", [])).toBe(false);
    });

    test("should match exact IPs", () => {
      expect(checkIpInRanges("1.2.3.4", ["1.2.3.4"])).toBe(true);
      expect(checkIpInRanges("1.2.3.4", ["5.6.7.8"])).toBe(false);
    });

    test("should match CIDR ranges", () => {
      expect(checkIpInRanges("192.168.1.5", ["192.168.0.0/16"])).toBe(true);
      expect(checkIpInRanges("10.0.0.5", ["192.168.0.0/16"])).toBe(false);
    });

    test("should handle IPv4-mapped IPv6 addresses", () => {
      // ::ffff:192.168.1.5 is mapped 192.168.1.5
      expect(checkIpInRanges("::ffff:192.168.1.5", ["192.168.0.0/16"])).toBe(
        true,
      );
    });

    test("should ignore invalid range configurations", () => {
      expect(checkIpInRanges("1.2.3.4", ["invalid-range"])).toBe(false);
    });

    test("should ignore mixed IP families mismatch", () => {
      // IPv4 vs IPv6 range
      expect(checkIpInRanges("1.2.3.4", ["::1/128"])).toBe(false);
    });
  });

  describe("validateUrlForSsrf", () => {
    beforeEach(() => {
      dnsPromisesMock.resolve4.mockReset();
      dnsPromisesMock.resolve6.mockReset();
    });

    test("should reject invalid URLs", async () => {
      const result = await validateUrlForSsrf("not-a-url");
      expect(result.safe).toBe(false);
      expect(result.error).toBe(SSRF_ERRORS.INVALID_URL);
    });

    test("should reject non-http protocols", async () => {
      const result = await validateUrlForSsrf("ftp://example.com");
      expect(result.safe).toBe(false);
      expect(result.error).toBe(SSRF_ERRORS.PROTOCOL_NOT_ALLOWED);
    });

    test("should reject URLs with credentials", async () => {
      const result = await validateUrlForSsrf("http://user:pass@example.com");
      expect(result.safe).toBe(false);
      expect(result.error).toBe(SSRF_ERRORS.CREDENTIALS_NOT_ALLOWED);
    });

    test("should validate IP literals directly", async () => {
      // Public IP
      const resSafe = await validateUrlForSsrf("http://8.8.8.8");
      expect(resSafe.safe).toBe(true);

      // Private IP
      const resPrivate = await validateUrlForSsrf("http://192.168.1.1");
      expect(resPrivate.safe).toBe(false);
      expect(resPrivate.error).toBe(SSRF_ERRORS.INTERNAL_IP);

      // Invalid IP literal (bracketed logic edge case)
      // [::1] is valid but blocked
      const resLoopback = await validateUrlForSsrf("http://[::1]");
      expect(resLoopback.safe).toBe(false);
    });

    test("should handle DNS resolution failures", async () => {
      dnsPromisesMock.resolve4.mockRejectedValue(new Error("ENOTFOUND"));
      dnsPromisesMock.resolve6.mockRejectedValue(new Error("ENOTFOUND"));

      const result = await validateUrlForSsrf("http://unknown-host.com");
      expect(result.safe).toBe(false);
      expect(result.error).toBe(SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED);
    });

    test("should handle DNS timeouts", async () => {
      dnsPromisesMock.resolve4.mockRejectedValue(
        new Error(SSRF_INTERNAL_ERRORS.DNS_TIMEOUT),
      );
      dnsPromisesMock.resolve6.mockRejectedValue(
        new Error(SSRF_INTERNAL_ERRORS.DNS_TIMEOUT),
      );

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await validateUrlForSsrf("http://timeout.com");
      expect(result.safe).toBe(false);
      expect(result.error).toBe(SSRF_ERRORS.VALIDATION_FAILED);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Validation error"),
        expect.stringContaining("DNS resolution timed out"),
      );
      consoleSpy.mockRestore();
    });

    test("should reject if resolved IP is blocked", async () => {
      dnsPromisesMock.resolve4.mockResolvedValue(["127.0.0.1"]);
      dnsPromisesMock.resolve6.mockResolvedValue([]);

      const result = await validateUrlForSsrf("http://localhost.com");
      expect(result.safe).toBe(false);
      expect(result.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should accept safe resolved IPs", async () => {
      dnsPromisesMock.resolve4.mockResolvedValue(["93.184.216.34"]); // example.com
      dnsPromisesMock.resolve6.mockResolvedValue([]);

      const result = await validateUrlForSsrf("http://example.com");
      expect(result.safe).toBe(true);
    });

    test("should handle invalid resolved IPs (paranoid check)", async () => {
      dnsPromisesMock.resolve4.mockResolvedValue(["invalid-ip-from-dns"]);
      dnsPromisesMock.resolve6.mockResolvedValue([]);

      const result = await validateUrlForSsrf("http://weird-dns.com");
      expect(result.safe).toBe(false);
      expect(result.error).toBe(SSRF_ERRORS.INVALID_IP);
    });
  });
});
