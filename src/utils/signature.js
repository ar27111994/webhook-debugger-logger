import crypto from "crypto";
import { DEFAULT_TOLERANCE_SECONDS } from "../consts.js";
import { secureCompare } from "./crypto.js";

/**
 * @typedef {import('crypto').Hmac} Hmac
 * @typedef {import('crypto').BinaryToTextEncoding} BinaryToTextEncoding
 * @typedef {import("../typedefs.js").SignatureEncoding} SignatureEncoding
 * @typedef {import("../typedefs.js").SignatureConfig} SignatureConfig
 * @typedef {import("../typedefs.js").SignatureResult} SignatureResult
 * @typedef {import("../typedefs.js").SignatureProvider} SignatureProvider
 */

/**
 * @typedef {Object} VerificationContext
 * @property {string} algorithm
 * @property {BinaryToTextEncoding} encoding
 * @property {string} prefix
 * @property {string} expectedSignature
 * @property {string} [timestamp]
 * @property {string} [error]
 * @property {() => boolean} [validateTimestamp]
 */

/**
 * @typedef {Object} VerificationResult
 * @property {Hmac | null} hmac
 * @property {string} expectedSignature
 * @property {BinaryToTextEncoding} encoding
 * @property {string} [error]
 */

export const SUPPORTED_PROVIDERS = Object.freeze([
  "stripe",
  "shopify",
  "github",
  "slack",
  "custom",
]);

/**
 * Verifies a webhook signature based on the provider configuration.
 * @param {SignatureConfig} config - Signature verification configuration
 * @param {string|Buffer} payload - Raw request body as string or Buffer
 * @param {Record<string, string>} headers - Request headers (lowercase keys)
 * @returns {SignatureResult}
 */
export function verifySignature(config, payload, headers) {
  const { provider, secret } = config;

  if (!secret) {
    return {
      valid: false,
      error: "No signing secret configured",
      provider: String(provider),
    };
  }

  // Get generic provider context (params, error, validation logic)
  const context = getProviderContext(provider || "custom", headers, config);

  if (context.error) {
    return {
      valid: false,
      error: context.error,
      provider: String(provider),
    };
  }

  // Validate timestamp if applicable
  if (
    context.timestamp &&
    context.validateTimestamp &&
    !context.validateTimestamp()
  ) {
    return invalidateSignatureWithAge(context.timestamp, provider || "custom");
  }

  // Compute expected HMAC
  const hmac = crypto.createHmac(context.algorithm, secret);
  if (context.prefix) {
    hmac.update(context.prefix);
  }

  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else {
    hmac.update(payload, "utf8");
  }

  const calculatedSignature = hmac.digest(context.encoding);

  // Compare
  const isValid = secureCompare(calculatedSignature, context.expectedSignature);

  return isValid
    ? { valid: true, provider: String(provider) }
    : {
        valid: false,
        error: "Signature mismatch",
        provider: String(provider),
      };
}

/**
 * Strategy pattern: returns standardized verification params for a given provider.
 * @param {SignatureProvider} provider
 * @param {Record<string, string>} headers
 * @param {SignatureConfig} config
 * @returns {VerificationContext}
 */
function getProviderContext(provider, headers, config) {
  /**
   * @type {VerificationContext}
   */
  const context = {
    algorithm: "sha256",
    encoding: "hex",
    prefix: "",
    expectedSignature: "",
    validateTimestamp: undefined,
  };

  try {
    switch (provider) {
      case "stripe": {
        /** @see https://docs.stripe.com/webhooks?lang=node#verify-events */
        const sigHeader = headers["stripe-signature"];
        if (!sigHeader) {
          context.error = "Missing Stripe-Signature header";
          return context;
        }

        const elements = sigHeader.split(",").reduce((acc, part) => {
          const [k, v] = part.split("=");
          acc[k] = v;
          return acc;
        }, /** @type {Record<string,string>} */ ({}));

        if (!elements.t || !elements.v1) {
          context.error = "Invalid Stripe-Signature format";
          return context;
        }

        context.timestamp = elements.t;
        context.prefix = `${context.timestamp}.`;
        context.expectedSignature = elements.v1;
        context.validateTimestamp = () =>
          !!context.timestamp &&
          isTimestampWithinTolerance(
            context.timestamp,
            config.tolerance || DEFAULT_TOLERANCE_SECONDS,
          );
        break;
      }

      case "shopify": {
        /** @see https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-2-validate-the-origin-of-your-webhook-to-ensure-its-coming-from-shopify */
        const sig =
          headers["x-shopify-hmac-sha256"] ||
          headers["http_x_shopify_hmac_sha256"];
        if (!sig) {
          context.error = "Missing X-Shopify-Hmac-SHA256 header";
          return context;
        }

        context.expectedSignature = sig;
        context.encoding = "base64";

        const timestamp =
          headers["x-shopify-triggered-at"] ||
          headers["http_x_shopify_triggered_at"];
        context.timestamp = timestamp;
        if (context.timestamp) {
          context.validateTimestamp = () =>
            !!context.timestamp &&
            isTimestampWithinTolerance(
              context.timestamp,
              config.tolerance || DEFAULT_TOLERANCE_SECONDS,
            );
        }
        break;
      }

      case "github": {
        /** @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#validating-webhook-deliveries */
        const sig = headers["x-hub-signature-256"];
        if (!sig) {
          context.error = "Missing X-Hub-Signature-256 header";
          return context;
        }

        if (!sig.startsWith("sha256=")) {
          context.error = "Invalid signature format";
          return context;
        }

        context.expectedSignature = sig.slice(7);
        break;
      }

      case "slack": {
        /** @see https://api.slack.com/authentication/verifying-requests-from-slack */
        const ts = headers["x-slack-request-timestamp"];
        const sig = headers["x-slack-signature"];
        if (!ts || !sig) {
          context.error = "Missing Slack signature headers";
          return context;
        }

        if (!sig.startsWith("v0=")) {
          context.error = "Invalid signature format";
          return context;
        }

        context.timestamp = ts;
        context.prefix = `v0:${context.timestamp}:`;
        context.expectedSignature = sig.slice(3);
        context.validateTimestamp = () =>
          !!context.timestamp &&
          isTimestampWithinTolerance(
            context.timestamp,
            config.tolerance || DEFAULT_TOLERANCE_SECONDS,
          );
        break;
      }

      case "custom": {
        const {
          headerName,
          algorithm = "sha256",
          encoding = "hex",
          timestampKey,
        } = config;

        if (!headerName) {
          context.error = "Custom provider requires headerName";
          return context;
        }

        const sig = headers[headerName.toLowerCase()];
        if (!sig) {
          context.error = `Missing ${headerName} header`;
          return context;
        }

        context.algorithm = algorithm;
        context.encoding = /** @type {BinaryToTextEncoding} */ (encoding);
        context.expectedSignature = sig;

        if (timestampKey) {
          const timestamp = headers[timestampKey.toLowerCase()];
          context.timestamp = timestamp;
          if (!context.timestamp) {
            context.error = `Missing timestamp header: ${timestampKey}`;
            return context;
          }
          context.validateTimestamp = () =>
            !!context.timestamp &&
            isTimestampWithinTolerance(
              context.timestamp,
              config.tolerance || DEFAULT_TOLERANCE_SECONDS,
            );
        }
        break;
      }

      default:
        context.error = `Unknown provider: ${provider}`;
    }
  } catch (err) {
    context.error = String(err);
  }

  return context;
}

/**
 * Helper to check timestamp tolerance.
 * @param {string} timestampStr - Timestamp string (seconds or ISO)
 * @param {number} tolerance - Tolerance in seconds
 * @returns {boolean} True if within tolerance
 */
function isTimestampWithinTolerance(timestampStr, tolerance) {
  // Support ISO 8601 or Unix seconds
  const timestampDate = !isNaN(Number(timestampStr))
    ? new Date(parseInt(timestampStr, 10) * 1000)
    : new Date(timestampStr);

  if (isNaN(timestampDate.getTime())) return false;

  const now = Date.now();
  const timestampMs = timestampDate.getTime();
  const toleranceMs = tolerance * 1000;

  return Math.abs(now - timestampMs) <= toleranceMs;
}

/**
 * Helper to return invalid signature result with age
 * @param {string} timestamp
 * @param {SignatureProvider} provider
 * @returns {SignatureResult}
 */
function invalidateSignatureWithAge(timestamp, provider) {
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);

  return {
    valid: false,
    error: `Timestamp outside tolerance (${timestampAge}s)`,
    provider,
  };
}

/**
 * Creates a configured HMAC object for streaming verification.
 * @param {SignatureConfig} config
 * @param {Record<string, string>} headers
 * @returns {VerificationResult}
 */
export function createStreamVerifier(config, headers) {
  const { provider, secret } = config;

  if (!secret)
    return {
      hmac: null,
      encoding: "hex",
      expectedSignature: "",
      error: "No secret",
    };

  // Reuse the exact same context logic
  const context = getProviderContext(provider || "custom", headers, config);

  if (context.error) {
    return {
      hmac: null,
      encoding: "hex",
      expectedSignature: "",
      error: context.error,
    };
  }

  // Enforce timestamp validation for streaming to prevent replay attacks
  // even before the body is fully received.
  if (
    context.timestamp &&
    context.validateTimestamp &&
    !context.validateTimestamp()
  ) {
    return {
      hmac: null,
      encoding: "hex",
      expectedSignature: "",
      error: invalidateSignatureWithAge(context.timestamp, provider || "custom")
        .error,
    };
  }

  try {
    const hmac = crypto.createHmac(context.algorithm, secret);
    if (context.prefix) {
      hmac.update(context.prefix);
    }

    return {
      hmac,
      encoding: context.encoding,
      expectedSignature: context.expectedSignature,
    };
  } catch (err) {
    return {
      hmac: null,
      encoding: "hex",
      expectedSignature: "",
      error: String(err),
    };
  }
}

/**
 * Finalizes the stream verification by calculating digest and comparing it.
 * @param {VerificationResult} verifier
 * @returns {boolean}
 */
export function finalizeStreamVerification(verifier) {
  if (!verifier.hmac) return false;
  const digest = verifier.hmac.digest(verifier.encoding);
  return secureCompare(digest, verifier.expectedSignature);
}
