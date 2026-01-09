import dns from "dns/promises";
import ipRangeCheck from "ip-range-check";

/**
 * IP ranges to block for SSRF prevention.
 * Includes loopback, private, link-local, and cloud metadata IPs.
 */
export const SSRF_BLOCKED_RANGES = [
  // IPv4 private/reserved ranges
  "127.0.0.0/8", // Loopback
  "10.0.0.0/8", // Private Class A
  "172.16.0.0/12", // Private Class B
  "192.168.0.0/16", // Private Class C
  "169.254.0.0/16", // Link-local
  "0.0.0.0/8", // Current network
  // Cloud metadata endpoints
  "169.254.169.254/32", // AWS/GCP/Azure metadata
  "100.100.100.200/32", // Alibaba Cloud metadata
  // IPv6 equivalents
  "::1/128", // Loopback
  "fc00::/7", // Unique local
  "fe80::/10", // Link-local
];

/**
 * Result of SSRF URL validation.
 * @typedef {Object} SsrfValidationResult
 * @property {boolean} safe - Whether the URL is safe to access
 * @property {string} [error] - Error message if not safe
 * @property {string} [href] - Normalized URL href if safe
 * @property {string} [host] - Host header value if safe
 */

/**
 * Validates a URL for SSRF safety.
 * Checks protocol, resolves hostname to IPs, and validates against blocked ranges.
 *
 * @param {string} urlString - The URL to validate
 * @returns {Promise<SsrfValidationResult>}
 */
export async function validateUrlForSsrf(urlString) {
  // Parse URL
  /** @type {URL} */
  let target;
  try {
    target = new URL(urlString);
  } catch {
    return { safe: false, error: "Invalid URL format" };
  }

  // Validate protocol
  if (!["http:", "https:"].includes(target.protocol)) {
    return { safe: false, error: "Only http/https URLs are allowed" };
  }

  // Resolve hostname and check IPs
  try {
    const hostname = target.hostname;
    const isIpLiteral =
      /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
      hostname.includes(":") ||
      hostname.startsWith("[");

    /** @type {string[]} */
    let ipsToCheck;

    if (isIpLiteral) {
      // Clean IPv6 brackets if present
      ipsToCheck = [hostname.replace(/^\[|\]$/g, "")];
    } else {
      // Resolve DNS - get both A and AAAA records
      const [ipv4Results, ipv6Results] = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname),
      ]);
      ipsToCheck = [
        ...(ipv4Results.status === "fulfilled" ? ipv4Results.value : []),
        ...(ipv6Results.status === "fulfilled" ? ipv6Results.value : []),
      ];
      if (ipsToCheck.length === 0) {
        return { safe: false, error: "Unable to resolve hostname" };
      }
    }

    // Check all resolved IPs against blocked ranges
    for (const ip of ipsToCheck) {
      if (ipRangeCheck(ip, SSRF_BLOCKED_RANGES)) {
        return {
          safe: false,
          error: "URL resolves to internal/reserved IP range",
        };
      }
    }

    return { safe: true, href: target.href, host: target.host };
  } catch {
    return { safe: false, error: "DNS resolution failed" };
  }
}
