/**
 * Signature Helper Utilities.
 *
 * These are used in tests to provide common functionality for signature verification.
 *
 * @module tests/setup/helpers/signature-utils
 */

import crypto from "crypto";
import {
  HASH_ALGORITHMS,
  SIGNATURE_ENCODINGS,
  SIGNATURE_PREFIXES,
} from "../../../src/consts/security.js";
import { assertType } from "./test-utils.js";
import { ENCODINGS } from "../../../src/consts/http.js";

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
    .createHmac(HASH_ALGORITHMS.SHA256, secret)
    .update(signedPayload)
    .digest(assertType(SIGNATURE_ENCODINGS.HEX));
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
    .createHmac(HASH_ALGORITHMS.SHA256, secret)
    .update(payload, ENCODINGS.UTF)
    .digest(assertType(SIGNATURE_ENCODINGS.BASE64));
}

/**
 * Creates a valid GitHub signature.
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 */
export function createGitHubSignature(payload, secret) {
  const signature = crypto
    .createHmac(HASH_ALGORITHMS.SHA256, secret)
    .update(payload)
    .digest(assertType(SIGNATURE_ENCODINGS.HEX));
  return `${SIGNATURE_PREFIXES.SHA256}${signature}`;
}

/**
 * Creates a valid Slack signature.
 * @param {string|number} timestamp
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 */
export function createSlackSignature(timestamp, payload, secret) {
  const sigBasestring = `${SIGNATURE_PREFIXES.V0_NO_PREFIX}:${timestamp}:${payload}`;
  const signature = crypto
    .createHmac(HASH_ALGORITHMS.SHA256, secret)
    .update(sigBasestring)
    .digest(assertType(SIGNATURE_ENCODINGS.HEX));
  return `${SIGNATURE_PREFIXES.V0}${signature}`;
}
