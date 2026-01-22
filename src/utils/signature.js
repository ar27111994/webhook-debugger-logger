import crypto from "crypto";
import { DEFAULT_TOLERANCE_SECONDS } from "../consts.js";

/**
 * @typedef {import("../typedefs.js").SignatureConfig} SignatureConfig
 * @typedef {import("../typedefs.js").SignatureResult} SignatureResult
 * @typedef {import("../typedefs.js").SignatureProvider} SignatureProvider
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
      error: "No signing secret configured",
      provider: String(provider),
    };
  }

  switch (provider) {
    case "stripe":
      return verifyStripe(secret, payload, headers, config.tolerance);
    case "shopify":
      return verifyShopify(secret, payload, headers, config.tolerance);
    case "github":
      return verifyGitHub(secret, payload, headers);
    case "slack":
      return verifySlack(secret, payload, headers, config.tolerance);
    case "custom":
      return verifyCustom(config, payload, headers);
    default:
      return {
        valid: false,
        error: `Unknown provider: ${provider}`,
        provider: String(provider),
      };
  }
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
 * @param {import("../typedefs.js").SignatureProvider} provider
 * @returns {SignatureResult}
 */
function invalideSignatureWithAge(timestamp, provider) {
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);

  return {
    valid: false,
    error: `Timestamp outside tolerance (${timestampAge}s)`,
    provider,
  };
}

/**
 * Verifies Stripe webhook signature.
 * @see https://docs.stripe.com/webhooks?lang=node#verify-events
 * @param {string} secret
 * @param {string|Buffer} payload
 * @param {Record<string, string>} headers
 * @param {number} [tolerance]
 * @returns {SignatureResult}
 */
function verifyStripe(
  secret,
  payload,
  headers,
  tolerance = DEFAULT_TOLERANCE_SECONDS,
) {
  const sigHeader = headers["stripe-signature"];
  if (!sigHeader) {
    return {
      valid: false,
      error: "Missing Stripe-Signature header",
      provider: "stripe",
    };
  }

  // Parse signature header: t=timestamp,v1=signature
  /** @type {Record<string, string>} */
  const elements = sigHeader
    .split(",")
    .reduce(
      (
        /** @type {Record<string, string>} */ acc,
        /** @type {string} */ part,
      ) => {
        const [key, value] = part.split("=");
        acc[key] = value;
        return acc;
      },
      {},
    );

  const timestamp = elements.t;
  const signature = elements.v1;

  if (!timestamp || !signature) {
    return {
      valid: false,
      error: "Invalid Stripe-Signature format",
      provider: "stripe",
    };
  }

  // Check timestamp tolerance
  if (!isTimestampWithinTolerance(timestamp, tolerance)) {
    return invalideSignatureWithAge(timestamp, "stripe");
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, error: "Signature mismatch", provider: "stripe" };
  }

  const isValid = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return isValid
    ? { valid: true, provider: "stripe" }
    : { valid: false, error: "Signature mismatch", provider: "stripe" };
}

/**
 * Verifies Shopify webhook signature.
 * @see https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-2-validate-the-origin-of-your-webhook-to-ensure-its-coming-from-shopify
 * @param {string} secret
 * @param {string|Buffer} payload
 * @param {Record<string, string>} headers
 * @param {number} [tolerance]
 * @returns {SignatureResult}
 */
function verifyShopify(
  secret,
  payload,
  headers,
  tolerance = DEFAULT_TOLERANCE_SECONDS,
) {
  const sigHeader =
    headers["x-shopify-hmac-sha256"] || headers["http_x_shopify_hmac_sha256"];

  if (!sigHeader) {
    return {
      valid: false,
      error: "Missing X-Shopify-Hmac-SHA256 header",
      provider: "shopify",
    };
  }

  // Replay Protection: Check X-Shopify-Triggered-At
  const timestamp =
    headers["x-shopify-triggered-at"] || headers["http_x_shopify_triggered_at"];
  if (timestamp) {
    // If header is present, enforce tolerance.
    // Note: Documentation says "Verify that the timestamp ... is within a tolerance"
    if (!isTimestampWithinTolerance(timestamp, tolerance)) {
      return invalideSignatureWithAge(timestamp, "shopify");
    }
  }

  const hmac = crypto.createHmac("sha256", secret);
  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else {
    hmac.update(payload, "utf8");
  }
  const expectedSignature = hmac.digest("base64");

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, "base64");
  const actualBuffer = Buffer.from(sigHeader, "base64");

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, error: "Signature mismatch", provider: "shopify" };
  }

  const isValid = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return isValid
    ? { valid: true, provider: "shopify" }
    : { valid: false, error: "Signature mismatch", provider: "shopify" };
}

/**
 * Verifies GitHub webhook signature.
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#validating-webhook-deliveries
 * @param {string} secret
 * @param {string|Buffer} payload
 * @param {Record<string, string>} headers
 * @returns {SignatureResult}
 */
function verifyGitHub(secret, payload, headers) {
  const sigHeader = headers["x-hub-signature-256"];
  if (!sigHeader) {
    return {
      valid: false,
      error: "Missing X-Hub-Signature-256 header",
      provider: "github",
    };
  }

  if (!sigHeader.startsWith("sha256=")) {
    return {
      valid: false,
      error: "Invalid signature format",
      provider: "github",
    };
  }

  const signature = sigHeader.slice(7); // Remove "sha256=" prefix
  const hmac = crypto.createHmac("sha256", secret);
  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else {
    hmac.update(payload, "utf8");
  }
  const expectedSignature = hmac.digest("hex");

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, error: "Signature mismatch", provider: "github" };
  }

  const isValid = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return isValid
    ? { valid: true, provider: "github" }
    : { valid: false, error: "Signature mismatch", provider: "github" };
}

/**
 * Verifies Slack webhook signature.
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 * @param {string} secret
 * @param {string|Buffer} payload
 * @param {Record<string, string>} headers
 * @param {number} [tolerance]
 * @returns {SignatureResult}
 */
function verifySlack(
  secret,
  payload,
  headers,
  tolerance = DEFAULT_TOLERANCE_SECONDS,
) {
  const timestamp = headers["x-slack-request-timestamp"];
  const sigHeader = headers["x-slack-signature"];

  if (!timestamp || !sigHeader) {
    return {
      valid: false,
      error: "Missing Slack signature headers",
      provider: "slack",
    };
  }

  // Check timestamp tolerance
  if (!isTimestampWithinTolerance(timestamp, tolerance)) {
    return invalideSignatureWithAge(timestamp, "slack");
  }

  if (!sigHeader.startsWith("v0=")) {
    return {
      valid: false,
      error: "Invalid signature format",
      provider: "slack",
    };
  }

  const signature = sigHeader.slice(3); // Remove "v0=" prefix
  const sigBasestring = `v0:${timestamp}:${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(sigBasestring)
    .digest("hex");

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, error: "Signature mismatch", provider: "slack" };
  }

  const isValid = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return isValid
    ? { valid: true, provider: "slack" }
    : { valid: false, error: "Signature mismatch", provider: "slack" };
}

/**
 * Verifies webhook signature using custom configuration.
 * @param {SignatureConfig} config
 * @param {string|Buffer} payload
 * @param {Record<string, string>} headers
 * @returns {SignatureResult}
 */
function verifyCustom(config, payload, headers) {
  const {
    secret,
    headerName,
    algorithm = "sha256",
    timestampKey,
    encoding = "hex",
    tolerance = DEFAULT_TOLERANCE_SECONDS,
  } = config;

  if (!headerName) {
    return {
      valid: false,
      error: "Custom provider requires headerName",
      provider: "custom",
    };
  }

  if (!secret) {
    return {
      valid: false,
      error: "Missing signing secret",
      provider: "custom",
    };
  }

  const sigHeader = headers[headerName.toLowerCase()];
  if (!sigHeader) {
    return {
      valid: false,
      error: `Missing ${headerName} header`,
      provider: "custom",
    };
  }

  // Custom Timestamp Check
  if (timestampKey) {
    const timestamp = headers[timestampKey.toLowerCase()];
    if (!timestamp) {
      return {
        valid: false,
        error: `Missing timestamp header: ${timestampKey}`,
        provider: "custom",
      };
    }

    if (!isTimestampWithinTolerance(timestamp, tolerance)) {
      return invalideSignatureWithAge(timestamp, "custom");
    }
  }

  const hmac = crypto.createHmac(algorithm, secret);
  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else {
    hmac.update(payload, "utf8");
  }

  // Use 'hex' or 'base64' based on config
  const expectedSignature = hmac.digest(encoding);

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, encoding);
  const actualBuffer = Buffer.from(sigHeader, encoding);

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, error: "Signature mismatch", provider: "custom" };
  }

  const isValid = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return isValid
    ? { valid: true, provider: "custom" }
    : { valid: false, error: "Signature mismatch", provider: "custom" };
}

export const SUPPORTED_PROVIDERS = Object.freeze([
  "stripe",
  "shopify",
  "github",
  "slack",
  "custom",
]);
