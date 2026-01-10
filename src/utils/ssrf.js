import dns from "dns/promises";
import net from "node:net";
import ipRangeCheck from "ip-range-check";

/**
 * IP ranges to block for SSRF prevention.
 * Includes loopback, private, link-local, and cloud metadata IPs.
 */
export const SSRF_BLOCKED_RANGES = [
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
];

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
    return { safe: false, error: "Invalid URL format" };
  }

  // Validate protocol
  if (!["http:", "https:"].includes(target.protocol)) {
    return { safe: false, error: "Only http/https URLs are allowed" };
  }

  // Disallow credentials in URL (userinfo)
  if (target.username || target.password) {
    return { safe: false, error: "Credentials in URL are not allowed" };
  }

  // Resolve hostname and check IPs
  try {
    const hostname = target.hostname;
    // Remove brackets from IPv6 literals for validation
    const hostnameUnbracketed = hostname.replace(/^\[|\]$/g, "");
    const isIpLiteral = net.isIP(hostnameUnbracketed) !== 0;

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
        return { safe: false, error: "Unable to resolve hostname" };
      }
    }

    // Check all resolved IPs against blocked ranges
    for (const ip of ipsToCheck) {
      const ipStr = String(ip || "").trim();
      if (!ipStr || net.isIP(ipStr) === 0) {
        return { safe: false, error: "URL resolves to invalid IP address" };
      }

      let isBlocked = false;
      try {
        isBlocked = ipRangeCheck(ipStr, SSRF_BLOCKED_RANGES);
      } catch {
        return { safe: false, error: "URL resolves to invalid IP address" };
      }

      if (isBlocked) {
        return {
          safe: false,
          error: "URL resolves to internal/reserved IP range",
        };
      }
    }

    return { safe: true, href: target.href, host: target.host };
  } catch {
    return { safe: false, error: "URL validation failed" };
  }
}
