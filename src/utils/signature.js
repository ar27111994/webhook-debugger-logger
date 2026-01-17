import crypto from "crypto";

/**
 * @typedef {Object} SignatureConfig
 * @property {"stripe" | "shopify" | "github" | "slack" | "custom"} provider
 * @property {string} secret - The signing secret
 * @property {string} [headerName] - Custom header name (for custom provider)
 * @property {"sha256" | "sha1"} [algorithm] - Hash algorithm (for custom provider)
 * @property {number} [tolerance] - Timestamp tolerance in seconds (default: 300)
 */

/**
 * @typedef {Object} SignatureResult
 * @property {boolean} valid
 * @property {string} [error]
 * @property {string} provider
 */

const DEFAULT_TOLERANCE_SECONDS = 300; // 5 minutes

/**
 * Verifies a webhook signature based on the provider configuration.
 * @param {SignatureConfig} config - Signature verification configuration
 * @param {string} payload - Raw request body as string
 * @param {Record<string, string>} headers - Request headers (lowercase keys)
 * @returns {SignatureResult}
 */
export function verifySignature(config, payload, headers) {
  const { provider, secret } = config;

  if (!secret) {
    return { valid: false, error: "No signing secret configured", provider };
  }

  switch (provider) {
    case "stripe":
      return verifyStripe(secret, payload, headers, config.tolerance);
    case "shopify":
      return verifyShopify(secret, payload, headers);
    case "github":
      return verifyGitHub(secret, payload, headers);
    case "slack":
      return verifySlack(secret, payload, headers, config.tolerance);
    case "custom":
      return verifyCustom(config, payload, headers);
    default:
      return { valid: false, error: `Unknown provider: ${provider}`, provider };
  }
}

/**
 * Verifies Stripe webhook signature.
 * @see https://stripe.com/docs/webhooks/signatures
 * @param {string} secret
 * @param {string} payload
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
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (Math.abs(timestampAge) > tolerance) {
    return {
      valid: false,
      error: `Timestamp outside tolerance (${timestampAge}s)`,
      provider: "stripe",
    };
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
 * @see https://shopify.dev/docs/apps/webhooks/configuration/https#step-5-verify-the-webhook
 * @param {string} secret
 * @param {string} payload
 * @param {Record<string, string>} headers
 * @returns {SignatureResult}
 */
function verifyShopify(secret, payload, headers) {
  const sigHeader = headers["x-shopify-hmac-sha256"];
  if (!sigHeader) {
    return { valid: false, error: "Missing X-Shopify-Hmac-SHA256 header", provider: "shopify" };
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64");

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(sigHeader, "utf8");

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
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 * @param {string} secret
 * @param {string} payload
 * @param {Record<string, string>} headers
 * @returns {SignatureResult}
 */
function verifyGitHub(secret, payload, headers) {
  const sigHeader = headers["x-hub-signature-256"];
  if (!sigHeader) {
    return { valid: false, error: "Missing X-Hub-Signature-256 header", provider: "github" };
  }

  if (!sigHeader.startsWith("sha256=")) {
    return { valid: false, error: "Invalid signature format", provider: "github" };
  }

  const signature = sigHeader.slice(7); // Remove "sha256=" prefix
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

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
 * @param {string} payload
 * @param {Record<string, string>} headers
 * @param {number} [tolerance]
 * @returns {SignatureResult}
 */
function verifySlack(secret, payload, headers, tolerance = DEFAULT_TOLERANCE_SECONDS) {
  const timestamp = headers["x-slack-request-timestamp"];
  const sigHeader = headers["x-slack-signature"];

  if (!timestamp || !sigHeader) {
    return { valid: false, error: "Missing Slack signature headers", provider: "slack" };
  }

  // Check timestamp tolerance
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (Math.abs(timestampAge) > tolerance) {
    return { valid: false, error: `Timestamp outside tolerance (${timestampAge}s)`, provider: "slack" };
  }

  if (!sigHeader.startsWith("v0=")) {
    return { valid: false, error: "Invalid signature format", provider: "slack" };
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
 * @param {string} payload
 * @param {Record<string, string>} headers
 * @returns {SignatureResult}
 */
function verifyCustom(config, payload, headers) {
  const { secret, headerName, algorithm = "sha256" } = config;

  if (!headerName) {
    return { valid: false, error: "Custom provider requires headerName", provider: "custom" };
  }

  const sigHeader = headers[headerName.toLowerCase()];
  if (!sigHeader) {
    return { valid: false, error: `Missing ${headerName} header`, provider: "custom" };
  }

  const expectedSignature = crypto
    .createHmac(algorithm, secret)
    .update(payload)
    .digest("hex");

  // Timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(sigHeader, "hex");

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
