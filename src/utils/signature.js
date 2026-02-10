/**
 * @file src/utils/signature.js
 * @description Cryptographic signature verification for webhooks (Stripe, GitHub, etc).
 * @module utils/signature
 */
import crypto from "crypto";
import {
  SIGNATURE_CONSTS,
  SIGNATURE_PROVIDERS,
  SIGNATURE_ENCODINGS,
  SIGNATURE_PREFIXES,
} from "../consts/security.js";
import { HTTP_HEADERS, ENCODINGS } from "../consts/http.js";
import { SIGNATURE_ERRORS } from "../consts/errors.js";
import { secureCompare } from "./crypto.js";
import { APP_CONSTS } from "../consts/app.js";

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
      error: SIGNATURE_ERRORS.NO_SECRET,
      provider: String(provider),
    };
  }

  // Get generic provider context (params, error, validation logic)
  const context = getProviderContext(
    provider || SIGNATURE_CONSTS.DEFAULT_PROVIDER,
    headers,
    config,
  );

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
    return invalidateSignatureWithAge(
      context.timestamp,
      provider || SIGNATURE_PROVIDERS.CUSTOM,
    );
  }

  // Compute expected HMAC
  const hmac = crypto.createHmac(context.algorithm, secret);
  if (context.prefix) {
    hmac.update(context.prefix);
  }

  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else {
    hmac.update(payload, ENCODINGS.UTF8);
  }

  const calculatedSignature = hmac.digest(context.encoding);

  // Compare
  const isValid = secureCompare(calculatedSignature, context.expectedSignature);

  return isValid
    ? { valid: true, provider: String(provider) }
    : {
        valid: false,
        error: SIGNATURE_ERRORS.MISMATCH,
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
    algorithm: SIGNATURE_CONSTS.DEFAULT_ALGORITHM,
    encoding: /** @type {BinaryToTextEncoding} */ (
      SIGNATURE_CONSTS.DEFAULT_ENCODING
    ),
    prefix: "",
    expectedSignature: "",
    validateTimestamp: undefined,
  };

  try {
    switch (provider) {
      case SIGNATURE_PROVIDERS.STRIPE: {
        /** @see https://docs.stripe.com/webhooks?lang=node#verify-events */
        const sigHeader = headers[HTTP_HEADERS.STRIPE_SIGNATURE];
        if (!sigHeader) {
          context.error = `${SIGNATURE_ERRORS.MISSING_HEADER}: ${HTTP_HEADERS.STRIPE_SIGNATURE}`;
          return context;
        }

        const elements = sigHeader.split(",").reduce((acc, part) => {
          const [k, v] = part.split("=");
          acc[k] = v;
          return acc;
        }, /** @type {Record<string,string>} */ ({}));

        if (!elements.t || !elements.v1) {
          context.error = `${SIGNATURE_ERRORS.INVALID_FORMAT}: ${HTTP_HEADERS.STRIPE_SIGNATURE}`;
          return context;
        }

        context.timestamp = elements.t;
        context.prefix = `${context.timestamp}.`;
        context.expectedSignature = elements.v1;
        context.validateTimestamp = () =>
          !!context.timestamp &&
          isTimestampWithinTolerance(
            context.timestamp,
            config.tolerance || SIGNATURE_CONSTS.TOLERANCE_SECONDS,
          );
        break;
      }

      case SIGNATURE_PROVIDERS.SHOPIFY: {
        /** @see https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-2-validate-the-origin-of-your-webhook-to-ensure-its-coming-from-shopify */
        const sig =
          headers[HTTP_HEADERS.SHOPIFY_HMAC_SHA256] ||
          headers[HTTP_HEADERS.SHOPIFY_HMAC_SHA256_FALLBACK];
        if (!sig) {
          context.error = `${SIGNATURE_ERRORS.MISSING_HEADER}: ${HTTP_HEADERS.SHOPIFY_HMAC_SHA256}`;
          return context;
        }

        context.expectedSignature = sig;
        context.encoding = /** @type {BinaryToTextEncoding} */ (
          SIGNATURE_ENCODINGS.BASE64
        );

        const timestamp =
          headers[HTTP_HEADERS.SHOPIFY_TRIGGERED_AT] ||
          headers[HTTP_HEADERS.SHOPIFY_TRIGGERED_AT_FALLBACK];
        context.timestamp = timestamp;
        if (context.timestamp) {
          context.validateTimestamp = () =>
            !!context.timestamp &&
            isTimestampWithinTolerance(
              context.timestamp,
              config.tolerance || SIGNATURE_CONSTS.TOLERANCE_SECONDS,
            );
        }
        break;
      }

      case SIGNATURE_PROVIDERS.GITHUB: {
        /** @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#validating-webhook-deliveries */
        const sig = headers[HTTP_HEADERS.HUB_SIGNATURE_256];
        if (!sig) {
          context.error = `${SIGNATURE_ERRORS.MISSING_HEADER}: ${HTTP_HEADERS.HUB_SIGNATURE_256}`;
          return context;
        }

        const prefix = SIGNATURE_PREFIXES.SHA256;
        if (!sig.startsWith(prefix)) {
          context.error = SIGNATURE_ERRORS.INVALID_FORMAT;
          return context;
        }

        context.expectedSignature = sig.slice(prefix.length);
        break;
      }

      case SIGNATURE_PROVIDERS.SLACK: {
        /** @see https://api.slack.com/authentication/verifying-requests-from-slack */
        const ts = headers[HTTP_HEADERS.SLACK_TIMESTAMP];
        const sig = headers[HTTP_HEADERS.SLACK_SIGNATURE];
        if (!ts || !sig) {
          context.error = `${SIGNATURE_ERRORS.MISSING_HEADER}: Slack`;
          return context;
        }

        const prefix = SIGNATURE_PREFIXES.V0;
        if (!sig.startsWith(prefix)) {
          context.error = SIGNATURE_ERRORS.INVALID_FORMAT;
          return context;
        }

        context.timestamp = ts;
        context.prefix = `${SIGNATURE_PREFIXES.V0_NO_PREFIX}:${context.timestamp}:`;
        context.expectedSignature = sig.slice(prefix.length);
        context.validateTimestamp = () =>
          !!context.timestamp &&
          isTimestampWithinTolerance(
            context.timestamp,
            config.tolerance || SIGNATURE_CONSTS.TOLERANCE_SECONDS,
          );
        break;
      }

      case SIGNATURE_PROVIDERS.CUSTOM: {
        const {
          headerName,
          algorithm = SIGNATURE_CONSTS.DEFAULT_ALGORITHM,
          encoding = /** @type {BinaryToTextEncoding} */ (
            SIGNATURE_CONSTS.DEFAULT_ENCODING
          ),
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
            context.error = `${SIGNATURE_ERRORS.MISSING_TIMESTAMP}: ${timestampKey}`;
            return context;
          }
          context.validateTimestamp = () =>
            !!context.timestamp &&
            isTimestampWithinTolerance(
              context.timestamp,
              config.tolerance || SIGNATURE_CONSTS.TOLERANCE_SECONDS,
            );
        }
        break;
      }

      default:
        context.error = `${SIGNATURE_ERRORS.UNKNOWN_PROVIDER}: ${provider}`;
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
    ? new Date(parseInt(timestampStr, 10) * APP_CONSTS.MS_PER_SECOND)
    : new Date(timestampStr);

  if (isNaN(timestampDate.getTime())) return false;

  const now = Date.now();
  const timestampMs = timestampDate.getTime();
  const toleranceMs = tolerance * APP_CONSTS.MS_PER_SECOND;

  return Math.abs(now - timestampMs) <= toleranceMs;
}

/**
 * Helper to return invalid signature result with age
 * @param {string} timestamp
 * @param {SignatureProvider} provider
 * @returns {SignatureResult}
 */
function invalidateSignatureWithAge(timestamp, provider) {
  const timestampAge =
    Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND) - parseInt(timestamp, 10);

  return {
    valid: false,
    error: `${SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE} (${timestampAge}s)`,
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
      encoding: /** @type {BinaryToTextEncoding} */ (SIGNATURE_ENCODINGS.HEX),
      expectedSignature: "",
      error: SIGNATURE_ERRORS.NO_SECRET,
    };

  // Reuse the exact same context logic
  const context = getProviderContext(
    provider || SIGNATURE_PROVIDERS.CUSTOM,
    headers,
    config,
  );

  if (context.error) {
    return {
      hmac: null,
      encoding: /** @type {BinaryToTextEncoding} */ (SIGNATURE_ENCODINGS.HEX),
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
      encoding: /** @type {BinaryToTextEncoding} */ (SIGNATURE_ENCODINGS.HEX),
      expectedSignature: "",
      error: invalidateSignatureWithAge(
        context.timestamp,
        provider || SIGNATURE_PROVIDERS.CUSTOM,
      ).error,
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
      encoding: /** @type {BinaryToTextEncoding} */ (SIGNATURE_ENCODINGS.HEX),
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
