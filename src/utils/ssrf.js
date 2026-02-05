import dns from "dns/promises";
import ipaddr from "ipaddr.js";
import {
  SSRF_INTERNAL_ERRORS,
  SSRF_LOG_MESSAGES,
  DNS_RESOLUTION_TIMEOUT_MS,
  SSRF_BLOCKED_RANGES,
  ALLOWED_PROTOCOLS,
} from "../consts.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger({ component: "SSRF" });

/**
 * @typedef {import('ipaddr.js').IPv6} IP
 * @typedef {import('../typedefs.js').SsrfValidationResult} SsrfValidationResult
 */

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
 * @returns {Promise<SsrfValidationResult>}
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
  if (!ALLOWED_PROTOCOLS.includes(target.protocol)) {
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
      const timeoutPromise =
        /**
         * Helper function to create a timeout promise.
         * @param {number} ms
         * @returns {Promise<never>}
         */
        (ms) =>
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(SSRF_INTERNAL_ERRORS.DNS_TIMEOUT)),
              ms,
            ),
          );

      const [ipv4Results, ipv6Results] = await Promise.allSettled([
        Promise.race([
          dns.resolve4(hostname),
          timeoutPromise(DNS_RESOLUTION_TIMEOUT_MS),
        ]),
        Promise.race([
          dns.resolve6(hostname),
          timeoutPromise(DNS_RESOLUTION_TIMEOUT_MS),
        ]),
      ]);
      ipsToCheck = [
        ...(ipv4Results.status === "fulfilled" ? ipv4Results.value : []),
        ...(ipv6Results.status === "fulfilled" ? ipv6Results.value : []),
      ];
      if (ipsToCheck.length === 0) {
        // Check if failure was due to timeout
        const errors = [ipv4Results, ipv6Results]
          .filter((r) => r.status === "rejected")
          .map((r) => /** @type {Error} */ (r.reason));

        if (
          errors.some((e) => e.message === SSRF_INTERNAL_ERRORS.DNS_TIMEOUT)
        ) {
          throw new Error(SSRF_INTERNAL_ERRORS.DNS_TIMEOUT);
        }

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

    /**
     * ADVISORY: TOCTOU (Time-of-Check Time-of-Use) Race Condition
     * This validation happens before the actual request. DNS records could change
     * between this check and the subsequent HTTP request.
     * Callers should ensure they do not cache this validation result for long periods.
     */
    return { safe: true, href: target.href, host: target.host };
  } catch (e) {
    // Sanitize error to avoid leaking full URL/credentials in logs
    const msg = e instanceof Error ? e.message : String(e);
    log.error(
      {
        error:
          msg === SSRF_INTERNAL_ERRORS.DNS_TIMEOUT
            ? SSRF_LOG_MESSAGES.DNS_TIMEOUT
            : SSRF_LOG_MESSAGES.RESOLUTION_FAILED,
      },
      "SSRF validation error",
    );
    return { safe: false, error: SSRF_ERRORS.VALIDATION_FAILED };
  }
}
