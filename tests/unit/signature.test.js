/**
 * @file tests/unit/signature.test.js
 * @description Unit tests for signature verification utilities.
 */

import { jest } from "@jest/globals";
import crypto from "crypto";
import {
  SIGNATURE_PROVIDERS,
  SIGNATURE_PREFIXES,
  HASH_ALGORITHMS,
  SIGNATURE_ENCODINGS,
  SIGNATURE_CONSTS,
} from "../../src/consts/security.js";
import { ENCODINGS, HTTP_HEADERS } from "../../src/consts/http.js";
import { SIGNATURE_ERRORS } from "../../src/consts/errors.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  createStripeSignature,
  createShopifySignature,
  createGitHubSignature,
  createSlackSignature,
} from "../setup/helpers/signature-utils.js";
import { APP_CONSTS } from "../../src/consts/app.js";
import { assertType } from "../setup/helpers/test-utils.js";

// NOT mocking crypto/utilCrypto to test real integration!
// We only need to reset modules to ensure clean state
await setupCommonMocks();

await jest.resetModules();
const { verifySignature, createStreamVerifier, finalizeStreamVerification } =
  await import("../../src/utils/signature.js");

describe("Signature Utils (Real Crypto)", () => {
  const SECRET = "test-secret";
  const PAYLOAD = '{"data":123}';
  const customHeaderName = "X-Custom-Sig";
  const customTimestampKey = "X-Custom-Time";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("verifySignature", () => {
    it("should return error if secret is missing", () => {
      const result = verifySignature(
        { provider: SIGNATURE_PROVIDERS.CUSTOM },
        PAYLOAD,
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBe(SIGNATURE_ERRORS.NO_SECRET);
    });

    it("should fail if calculated signature does not match expected", () => {
      const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
      const header = createStripeSignature(timestamp, PAYLOAD, "wrong-secret");
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };
      const result = verifySignature(
        { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
        PAYLOAD,
        headers,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBe(SIGNATURE_ERRORS.MISMATCH);
    });

    it("should handle Buffer payload correctly", () => {
      const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
      const header = createStripeSignature(timestamp, PAYLOAD, SECRET);
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };
      const bufferPayload = Buffer.from(PAYLOAD);

      const result = verifySignature(
        { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
        bufferPayload,
        headers,
      );
      expect(result.valid).toBe(true);
    });

    describe("Stripe", () => {
      it("should verify Stripe signatures", () => {
        const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
        const header = createStripeSignature(timestamp, PAYLOAD, SECRET);
        const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(true);
      });

      it("should fail missing Stripe header", () => {
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
          PAYLOAD,
          {},
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.MISSING_HEADER);
      });

      it("should catch exceptions in getProviderContext", () => {
        // Pass undefined headers to force an exception
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
          PAYLOAD,
          assertType(undefined),
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain("TypeError");
      });

      it("should fail malformed Stripe header", () => {
        const headers = {
          [HTTP_HEADERS.STRIPE_SIGNATURE]: `t=${Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND)}`,
        }; // Missing v1
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.INVALID_FORMAT);
      });

      it("should fail if timestamp is too old", () => {
        const tenMinutesInSeconds = 600;
        const oldTimestamp =
          Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND) -
          tenMinutesInSeconds;
        const header = createStripeSignature(oldTimestamp, PAYLOAD, SECRET);
        const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };
        const result = verifySignature(
          {
            provider: SIGNATURE_PROVIDERS.STRIPE,
            secret: SECRET,
            tolerance: SIGNATURE_CONSTS.TOLERANCE_SECONDS,
          },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE);
      });
    });

    describe("Shopify", () => {
      it("should verify Shopify signatures", () => {
        const header = createShopifySignature(PAYLOAD, SECRET);
        const headers = { [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: header };
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.SHOPIFY, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(true);
      });

      it("should fail missing Shopify header", () => {
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.SHOPIFY, secret: SECRET },
          PAYLOAD,
          {},
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.MISSING_HEADER);
      });

      it("should fail Shopify if timestamp is too old", () => {
        const tenMinutesInSeconds = 600;
        const oldTimestamp = new Date(
          Date.now() - tenMinutesInSeconds * APP_CONSTS.MS_PER_SECOND,
        ).toISOString();
        const header = createShopifySignature(PAYLOAD, SECRET);
        const headers = {
          [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: header,
          [HTTP_HEADERS.SHOPIFY_TRIGGERED_AT]: oldTimestamp,
        };
        // Omit tolerance to hit default fallback
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.SHOPIFY, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE);
      });
    });

    describe("GitHub", () => {
      it("should verify GitHub signatures", () => {
        const header = createGitHubSignature(PAYLOAD, SECRET);
        const headers = { [HTTP_HEADERS.HUB_SIGNATURE_256]: header };
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.GITHUB, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(true);
      });

      it("should fail missing GitHub header", () => {
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.GITHUB, secret: SECRET },
          PAYLOAD,
          {},
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.MISSING_HEADER);
      });

      it("should fail invalid GitHub prefix", () => {
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(PAYLOAD)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = {
          [HTTP_HEADERS.HUB_SIGNATURE_256]: `${SIGNATURE_PREFIXES.SHA1}${signature}`,
        };
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.GITHUB, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.INVALID_FORMAT);
      });
    });

    describe("Slack", () => {
      it("should verify Slack signatures", () => {
        const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
        const header = createSlackSignature(timestamp, PAYLOAD, SECRET);
        const headers = {
          [HTTP_HEADERS.SLACK_TIMESTAMP]: timestamp.toString(),
          [HTTP_HEADERS.SLACK_SIGNATURE]: header,
        };
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.SLACK, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(true);
      });

      it("should fail Slack verification if timestamp is missing", () => {
        const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
        const header = createSlackSignature(timestamp, PAYLOAD, SECRET);
        const headers = { [HTTP_HEADERS.SLACK_SIGNATURE]: header };
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.SLACK, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.MISSING_HEADER);
      });

      it("should fail invalid Slack prefix", () => {
        const timestamp = Math.floor(
          Date.now() / APP_CONSTS.MS_PER_SECOND,
        ).toString();
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(`${SIGNATURE_PREFIXES.V0_NO_PREFIX}:${timestamp}:${PAYLOAD}`)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = {
          [HTTP_HEADERS.SLACK_TIMESTAMP]: timestamp,
          [HTTP_HEADERS.SLACK_SIGNATURE]: `${SIGNATURE_PREFIXES.V1}${signature}`, // Invalid prefix (should be v0=)
        };
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.SLACK, secret: SECRET },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.INVALID_FORMAT);
      });
    });

    describe("Custom Provider", () => {
      it("should verify Custom signatures", () => {
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(PAYLOAD, ENCODINGS.UTF)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = { [customHeaderName.toLowerCase()]: signature };
        const result = verifySignature(
          {
            provider: SIGNATURE_PROVIDERS.CUSTOM,
            secret: SECRET,
            headerName: customHeaderName,
          },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(true);
      });

      it("should fail Custom if headerName configuration is missing", () => {
        const result = verifySignature(
          { provider: SIGNATURE_PROVIDERS.CUSTOM, secret: SECRET },
          PAYLOAD,
          {},
        );
        expect(result.valid).toBe(false);
        expect(result.error).toBe(SIGNATURE_ERRORS.CUSTOM_HEADER_REQUIRED);
      });

      it("should fail Custom if signature header is missing in request", () => {
        const result = verifySignature(
          {
            provider: SIGNATURE_PROVIDERS.CUSTOM,
            secret: SECRET,
            headerName: customHeaderName,
          },
          PAYLOAD,
          {},
        );
        expect(result.valid).toBe(false);
        expect(result.error).toBe(
          SIGNATURE_ERRORS.MISSING_CUSTOM_HEADER(customHeaderName),
        );
      });

      it("should support timestamp validation for custom providers (ISO 8601)", () => {
        const validTimestamp = new Date().toISOString();
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(PAYLOAD, ENCODINGS.UTF)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = {
          [customHeaderName.toLowerCase()]: signature,
          [customTimestampKey.toLowerCase()]: validTimestamp,
        };
        const result = verifySignature(
          {
            provider: SIGNATURE_PROVIDERS.CUSTOM,
            secret: SECRET,
            headerName: customHeaderName,
            timestampKey: customTimestampKey,
          },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(true);
      });

      it("should fail Custom if required timestamp header is missing", () => {
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(PAYLOAD, ENCODINGS.UTF)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = { [customHeaderName.toLowerCase()]: signature };
        const result = verifySignature(
          {
            provider: SIGNATURE_PROVIDERS.CUSTOM,
            secret: SECRET,
            headerName: customHeaderName,
            timestampKey: customTimestampKey,
          },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.MISSING_TIMESTAMP);
      });

      it("should fallback to DEFAULT_PROVIDER (CUSTOM) if provider is omitted", () => {
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(PAYLOAD, ENCODINGS.UTF)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = { [customHeaderName.toLowerCase()]: signature };
        const result = verifySignature(
          { secret: SECRET, headerName: customHeaderName },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(true);
      });

      it("should hit provider fallback when timestamp is too old without provider", () => {
        const tenMinutesInSeconds = 600;
        const oldTimestamp = new Date(
          Date.now() - tenMinutesInSeconds * APP_CONSTS.MS_PER_SECOND,
        ).toISOString();
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(PAYLOAD, ENCODINGS.UTF)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = {
          [customHeaderName.toLowerCase()]: signature,
          [customTimestampKey.toLowerCase()]: oldTimestamp,
        };
        const result = verifySignature(
          {
            secret: SECRET,
            headerName: customHeaderName,
            timestampKey: customTimestampKey,
          },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.provider).toBe(SIGNATURE_PROVIDERS.CUSTOM);
      });

      it("should handle completely unparseable timestamps", () => {
        // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
        const signature = crypto
          .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
          .update(PAYLOAD, ENCODINGS.UTF)
          .digest(assertType(SIGNATURE_ENCODINGS.HEX));
        const headers = {
          [customHeaderName.toLowerCase()]: signature,
          [customTimestampKey.toLowerCase()]: "not-a-date",
        };
        const result = verifySignature(
          {
            provider: SIGNATURE_PROVIDERS.CUSTOM,
            secret: SECRET,
            headerName: customHeaderName,
            timestampKey: customTimestampKey,
          },
          PAYLOAD,
          headers,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE);
      });
    });

    describe("Generic Error Handling", () => {
      it("should handle unknown providers", () => {
        const result = verifySignature(
          { provider: "UNKNOWN_MAGIC", secret: SECRET },
          PAYLOAD,
          {},
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain(SIGNATURE_ERRORS.UNKNOWN_PROVIDER);
      });
    });
  });

  describe("createStreamVerifier", () => {
    it("should return initial hmac for streaming", () => {
      const header = createGitHubSignature(PAYLOAD, SECRET);
      const headers = { [HTTP_HEADERS.HUB_SIGNATURE_256]: header };
      const verifier = createStreamVerifier(
        { provider: SIGNATURE_PROVIDERS.GITHUB, secret: SECRET },
        headers,
      );

      expect(verifier.hmac).toBeDefined();
      // expectedSignature should be extracted without the sha256= prefix
      const expectedSig = header.replace(
        assertType(SIGNATURE_PREFIXES.SHA256),
        "",
      );
      expect(verifier.expectedSignature).toBe(expectedSig);
      expect(verifier.error).toBeUndefined();
    });

    it("should return error if secrets are missing", () => {
      const verifier = createStreamVerifier(
        { provider: SIGNATURE_PROVIDERS.CUSTOM },
        {},
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toBe(SIGNATURE_ERRORS.NO_SECRET);
    });

    it("should return error if context has error", () => {
      // Missing headers
      const verifier = createStreamVerifier(
        { provider: SIGNATURE_PROVIDERS.GITHUB, secret: SECRET },
        {},
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toContain(SIGNATURE_ERRORS.MISSING_HEADER);
    });

    it("should apply prefix for streaming with Stripe", () => {
      const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
      const header = createStripeSignature(timestamp, PAYLOAD, SECRET);
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };
      const verifier = createStreamVerifier(
        { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
        headers,
      );

      // Just verifying it works as intended without error
      expect(verifier.hmac).toBeDefined();
      expect(verifier.error).toBeUndefined();
    });

    it("should fallback to CUSTOM provider if omitted in createStreamVerifier", () => {
      const headers = { [customHeaderName.toLowerCase()]: "dummy" };
      const verifier = createStreamVerifier(
        { secret: SECRET, headerName: customHeaderName },
        headers,
      );
      expect(verifier.hmac).toBeDefined();
    });

    it("should pre-validate timestamp during stream creation", () => {
      const tenMinutesInSeconds = 600;
      const oldTimestamp =
        Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND) - tenMinutesInSeconds;
      const header = createStripeSignature(oldTimestamp, PAYLOAD, SECRET);
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };
      const verifier = createStreamVerifier(
        {
          provider: SIGNATURE_PROVIDERS.STRIPE,
          secret: SECRET,
          tolerance: SIGNATURE_CONSTS.TOLERANCE_SECONDS,
        },
        headers,
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toContain(SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE);
    });

    it("should hit provider fallback when timestamp is too old in createStreamVerifier", () => {
      const tenMinutesInSeconds = 600;
      const oldTimestamp =
        Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND) - tenMinutesInSeconds;
      // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
      const signature = crypto
        .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
        .update(PAYLOAD, ENCODINGS.UTF)
        .digest(assertType(SIGNATURE_ENCODINGS.HEX));
      const headers = {
        [customHeaderName.toLowerCase()]: signature,
        [customTimestampKey.toLowerCase()]: oldTimestamp.toString(),
      };
      // Omit provider
      const verifier = createStreamVerifier(
        {
          secret: SECRET,
          headerName: customHeaderName,
          timestampKey: customTimestampKey,
        },
        headers,
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toContain(SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE);
    });

    it("should catch unexpected errors during HMAC creation", () => {
      const cryptoError = "Crypto Crash";
      const spy = jest
        .spyOn(crypto, "createHmac")
        .mockImplementationOnce(() => {
          throw new Error(cryptoError);
        });

      const headers = { [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: "dummy" };
      const verifier = createStreamVerifier(
        { provider: SIGNATURE_PROVIDERS.SHOPIFY, secret: SECRET },
        headers,
      );

      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toContain(cryptoError);

      spy.mockRestore();
    });
  });

  describe("finalizeStreamVerification", () => {
    it("should return true if digests match", () => {
      const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
      const header = createStripeSignature(timestamp, PAYLOAD, SECRET);
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };

      const verifier = createStreamVerifier(
        { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
        headers,
      );
      // Simulate the stream writing data
      verifier.hmac?.update(PAYLOAD, ENCODINGS.UTF);

      const result = finalizeStreamVerification(verifier);
      expect(result).toBe(true);
    });

    it("should return false if verifier has no hmac (error state)", () => {
      const result = finalizeStreamVerification(assertType({ hmac: null }));
      expect(result).toBe(false);
    });
  });

  describe("Advanced Security & Concurrency", () => {
    it("should handle concurrency safely without sharing state", async () => {
      const iterations = 50;
      const tasks = [];

      for (let i = 0; i < iterations; i++) {
        const timestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND);
        const header = createStripeSignature(timestamp, PAYLOAD, SECRET);
        const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: header };
        tasks.push(
          Promise.resolve(
            verifySignature(
              { provider: SIGNATURE_PROVIDERS.STRIPE, secret: SECRET },
              PAYLOAD,
              headers,
            ),
          ),
        );
      }

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(iterations);
      results.forEach((res) => expect(res.valid).toBe(true));
    });
  });
});
