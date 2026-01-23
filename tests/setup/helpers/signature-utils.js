import crypto from "crypto";

/**
 * Creates a valid Stripe signature.
 * @param {number} timestamp
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 */
export function createStripeSignature(timestamp, payload, secret) {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Creates a valid Shopify signature.
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 */
export function createShopifySignature(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64");
}

/**
 * Creates a valid GitHub signature.
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 */
export function createGitHubSignature(payload, secret) {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return `sha256=${signature}`;
}

/**
 * Creates a valid Slack signature.
 * @param {string|number} timestamp
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 */
export function createSlackSignature(timestamp, payload, secret) {
  const sigBasestring = `v0:${timestamp}:${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(sigBasestring)
    .digest("hex");
  return `v0=${signature}`;
}
