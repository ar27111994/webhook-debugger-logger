/**
 * @file tests/setup/helpers/fixtures/payload-fixtures.js
 * @description Shared request/security fixture builders for integration and e2e tests.
 * @module tests/setup/helpers/fixtures/payload-fixtures
 */

import { AUTH_CONSTS } from "../../../../src/consts/auth.js";
import {
  HTTP_HEADERS,
  HTTP_METHODS,
  MIME_TYPES,
} from "../../../../src/consts/http.js";
import { SIGNATURE_PROVIDERS } from "../../../../src/consts/security.js";

/**
 * @typedef {Object} WebhookPayloadFixture
 * @property {string} id
 * @property {string} event
 * @property {string} source
 * @property {string} timestamp
 * @property {Record<string, unknown>} data
 */

/**
 * Creates a baseline webhook payload fixture.
 *
 * @param {Partial<WebhookPayloadFixture>} [overrides={}]
 * @returns {WebhookPayloadFixture}
 */
export function createWebhookPayload(overrides = {}) {
  return {
    id: "evt_test_001",
    event: "payment.succeeded",
    source: SIGNATURE_PROVIDERS.STRIPE,
    timestamp: new Date().toISOString(),
    data: {
      amount: 1999,
      currency: "USD",
      customerId: "cus_123",
    },
    ...overrides,
  };
}

/**
 * Creates default webhook headers for JSON ingestion.
 *
 * @param {Record<string, string>} [overrides={}]
 * @returns {Record<string, string>}
 */
export function createWebhookHeaders(overrides = {}) {
  return {
    [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON,
    [HTTP_HEADERS.USER_AGENT]: "WebhookFixture/1.0",
    ...overrides,
  };
}

/**
 * Creates authorization headers using bearer token format.
 *
 * @param {string} token
 * @returns {Record<string, string>}
 */
export function createAuthHeaders(token) {
  return {
    [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${token}`,
  };
}

/**
 * Returns malformed payload variants for sanitation testing.
 *
 * @returns {Array<{ label: string, body: string, contentType: string, method: string }>}
 */
export function createMalformedPayloadFixtures() {
  return [
    {
      label: "invalid_json",
      body: '{"missing": "quote}',
      contentType: MIME_TYPES.JSON,
      method: HTTP_METHODS.POST,
    },
    {
      label: "plain_text",
      body: "just-text",
      contentType: MIME_TYPES.TEXT,
      method: HTTP_METHODS.POST,
    },
    {
      label: "xml_like",
      body: "<event><id>evt</id></event>",
      contentType: MIME_TYPES.XML,
      method: HTTP_METHODS.POST,
    },
  ];
}
