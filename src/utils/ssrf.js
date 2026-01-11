import dns from "dns/promises";
import ipaddr from "ipaddr.js";

/** @typedef {import('ipaddr.js').IPv6} IP */

/**
 * IP ranges to block for SSRF prevention.
 * Includes loopback, private, link-local, and cloud metadata IPs.
 */
export const SSRF_BLOCKED_RANGES = Object.freeze([
  // IPv4 private/reserved ranges
  "0.0.0.0/8", // Current network
  "10.0.0.0/8", // Private Class A
  "100.64.0.0/10", // Carrier-grade NAT
  "127.0.0.0/8", // Loopback
  "169.254.0.0/16", // Link-local
  "172.16.0.0/12", // Private Class B
  "192.168.0.0/16", // Private Class C
  "224.0.0.0/4", // Multicast
  "240.0.0.0/4", // Reserved
  "255.255.255.255/32", // Broadcast

  // Cloud metadata endpoints
  "169.254.169.254/32", // AWS/GCP/Azure metadata
  "100.100.100.200/32", // Alibaba Cloud metadata

  // IPv6 equivalents
  "::1/128", // Loopback
  "fc00::/7", // Unique local
  "fe80::/10", // Link-local
  "ff00::/8", // Multicast
]);

/**
 * Error messages for SSRF validation.
 */
export const SSRF_ERRORS = Object.freeze({
  INVALID_URL: "Invalid URL format",
  PROTOCOL_NOT_ALLOWED: "Only http/https URLs are allowed",
  CREDENTIALS_NOT_ALLOWED: "Credentials in URL are not allowed",
  HOSTNAME_RESOLUTION_FAILED: "Unable to resolve hostname",
  INVALID_IP: "URL resolves to invalid IP address",
  INTERNAL_IP: "URL resolves to internal/reserved IP range",
  VALIDATION_FAILED: "URL validation failed",
});

/**
 * Checks if an IP address falls within any of the specified CIDR ranges.
 * Checks if an IP address falls within any of the specified CIDR ranges or single IP addresses.
 * Uses ipaddr.js for robust parsing and matching.
 *
 * @param {string} ipStr - The IP address string to check
 * @param {readonly string[]} ranges - List of CIDR ranges or single IP addresses
 * @returns {boolean} - True if IP is in one of the ranges
 */
export function checkIpInRanges(ipStr, ranges) {
  if (!ipStr) return false;

  let clientIp;
  try {
    clientIp = ipaddr.parse(ipStr);
    // Map IPv4-mapped IPv6 addresses to IPv4 for proper comparison
    if (
      clientIp.kind() === "ipv6" &&
      /** @type {IP} */ (clientIp).isIPv4MappedAddress()
    ) {
      clientIp = /** @type {IP} */ (clientIp).toIPv4Address();
    }
  } catch {
    return false;
  }

  for (const rangeStr of ranges) {
    try {
      let rangeIp;
      let prefix;

      // Check if the range string implies a CIDR subnet
      if (rangeStr.includes("/")) {
        [rangeIp, prefix] = ipaddr.parseCIDR(rangeStr);
      } else {
        // Treat as a single IP address
        rangeIp = ipaddr.parse(rangeStr);
        prefix = rangeIp.kind() === "ipv4" ? 32 : 128;
      }

      // Ensure IP families match before comparing
      if (clientIp.kind() === rangeIp.kind()) {
        if (clientIp.match([rangeIp, prefix])) {
          return true;
        }
      }
    } catch {
      // Ignore invalid config entries to maintain stability
      continue;
    }
  }
  return false;
}

/**
 * Validates a URL for SSRF safety.
 * Checks protocol, resolves hostname to IPs, and validates against blocked ranges.
 *
 * @param {string} urlString - The URL to validate
 * @returns {Promise<import('../typedefs.js').SsrfValidationResult>}
 */
export async function validateUrlForSsrf(urlString) {
  // Parse URL
  /** @type {URL} */
  let target;
  try {
    target = new URL(urlString);
  } catch {
    return { safe: false, error: SSRF_ERRORS.INVALID_URL };
  }

  // Validate protocol
  if (!["http:", "https:"].includes(target.protocol)) {
    return { safe: false, error: SSRF_ERRORS.PROTOCOL_NOT_ALLOWED };
  }

  // Disallow credentials in URL (userinfo)
  if (target.username || target.password) {
    return { safe: false, error: SSRF_ERRORS.CREDENTIALS_NOT_ALLOWED };
  }

  // Resolve hostname and check IPs
  try {
    const hostname = target.hostname;
    // Remove brackets from IPv6 literals for validation
    const hostnameUnbracketed = hostname.replace(/^\[|\]$/g, "");

    // Check if it's already an IP literal
    const isIpLiteral = ipaddr.isValid(hostnameUnbracketed);

    /** @type {string[]} */
    let ipsToCheck;

    if (isIpLiteral) {
      ipsToCheck = [hostnameUnbracketed];
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
        return { safe: false, error: SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED };
      }
    }

    // Check all resolved IPs against blocked ranges
    for (const ipStr of ipsToCheck) {
      if (checkIpInRanges(ipStr, SSRF_BLOCKED_RANGES)) {
        return {
          safe: false,
          error: SSRF_ERRORS.INTERNAL_IP,
        };
      }

      // Also validate basic validity
      if (!ipaddr.isValid(ipStr)) {
        return { safe: false, error: SSRF_ERRORS.INVALID_IP };
      }
    }

    return { safe: true, href: target.href, host: target.host };
  } catch (e) {
    console.error("[SSRF] Validation error:", e);
    return { safe: false, error: SSRF_ERRORS.VALIDATION_FAILED };
  }
}
