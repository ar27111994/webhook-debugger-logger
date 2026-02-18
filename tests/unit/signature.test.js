import { describe, test, expect } from "@jest/globals";
import crypto from "crypto";
import {
  verifySignature,
  createStreamVerifier,
  finalizeStreamVerification,
} from "../../src/utils/signature.js";
import { SUPPORTED_PROVIDERS } from "../../src/consts/security.js";
import {
  createStripeSignature,
  createShopifySignature,
  createGitHubSignature,
  createSlackSignature,
} from "../setup/helpers/signature-utils.js";
import { assertType } from "../setup/helpers/test-utils.js";
import { HTTP_HEADERS } from "../../src/consts/http.js";

describe("Signature Verification", () => {
  describe("Stripe", () => {
    const secret = "whsec_test_secret_key";
    const payload = JSON.stringify({
      type: "payment_intent.succeeded",
      id: "pi_123",
    });

    test("should verify valid Stripe signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const sigHeader = createStripeSignature(timestamp, payload, secret);
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: sigHeader };

      const result = verifySignature(
        { provider: "stripe", secret },
        payload,
        headers,
      );
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("stripe");
    });

    test("should reject invalid Stripe signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const sigHeader = createStripeSignature(
        timestamp,
        payload,
        "wrong_secret",
      );
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: sigHeader };

      const result = verifySignature(
        { provider: "stripe", secret },
        payload,
        headers,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("mismatch");
    });

    test("should reject Stripe signature with invalid format", () => {
      const result = verifySignature(
        { provider: "stripe", secret },
        payload,
        { [HTTP_HEADERS.STRIPE_SIGNATURE]: "v1=abc" }, // Missing 't'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("format");
    });

    test("should reject expired Stripe timestamp", () => {
      const timestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      const sigHeader = createStripeSignature(timestamp, payload, secret);
      const headers = { [HTTP_HEADERS.STRIPE_SIGNATURE]: sigHeader };

      const result = verifySignature(
        { provider: "stripe", secret, tolerance: 300 },
        payload,
        headers,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("tolerance");
    });

    test("should reject missing Stripe-Signature header", () => {
      const result = verifySignature(
        { provider: "stripe", secret },
        payload,
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing");
    });
  });

  describe("Shopify", () => {
    const secret = "shopify_secret_key";
    const payload = JSON.stringify({ topic: "orders/create", id: "123" });

    test("should verify valid Shopify signature", () => {
      const signature = createShopifySignature(payload, secret);
      const headers = { [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: signature };

      const result = verifySignature(
        { provider: "shopify", secret },
        payload,
        headers,
      );
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("shopify");
    });

    test("should verify Shopify with timestamp validation", () => {
      const signature = createShopifySignature(payload, secret);
      const headers = {
        [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: signature,
        [HTTP_HEADERS.SHOPIFY_TRIGGERED_AT]: new Date().toISOString(),
      };

      const result = verifySignature(
        { provider: "shopify", secret, tolerance: 60 },
        payload,
        headers,
      );
      expect(result.valid).toBe(true);
    });

    test("should reject Shopify with expired timestamp", () => {
      const signature = createShopifySignature(payload, secret);
      const headers = {
        [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: signature,
        [HTTP_HEADERS.SHOPIFY_TRIGGERED_AT]: new Date(
          Date.now() - 100000,
        ).toISOString(),
      };

      const result = verifySignature(
        { provider: "shopify", secret, tolerance: 10 },
        payload,
        headers,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("tolerance");
    });

    test("should reject missing Shopify header", () => {
      const result = verifySignature(
        { provider: "shopify", secret },
        payload,
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing");
    });
  });

  describe("GitHub", () => {
    const secret = "github_webhook_secret";
    const payload = JSON.stringify({ action: "opened", pull_request: {} });

    test("should verify valid GitHub signature", () => {
      const signature = createGitHubSignature(payload, secret);
      const headers = { [HTTP_HEADERS.HUB_SIGNATURE_256]: signature };

      const result = verifySignature(
        { provider: "github", secret },
        payload,
        headers,
      );
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("github");
    });

    test("should reject GitHub signature with invalid format", () => {
      const result = verifySignature({ provider: "github", secret }, payload, {
        [HTTP_HEADERS.HUB_SIGNATURE_256]: "plain-text-sig",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("format");
    });

    test("should reject missing GitHub header", () => {
      const result = verifySignature(
        { provider: "github", secret },
        payload,
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing");
    });
  });

  describe("Slack", () => {
    const secret = "slack_signing_secret";
    const payload = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J";

    test("should verify valid Slack signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createSlackSignature(timestamp, payload, secret);
      const headers = {
        [HTTP_HEADERS.SLACK_TIMESTAMP]: String(timestamp),
        [HTTP_HEADERS.SLACK_SIGNATURE]: signature,
      };

      const result = verifySignature(
        { provider: "slack", secret },
        payload,
        headers,
      );
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("slack");
    });

    test("should reject Slack signature with invalid format", () => {
      const result = verifySignature({ provider: "slack", secret }, payload, {
        [HTTP_HEADERS.SLACK_TIMESTAMP]: String(Math.floor(Date.now() / 1000)),
        [HTTP_HEADERS.SLACK_SIGNATURE]: "v1=abc",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("format");
    });

    test("should reject missing Slack headers", () => {
      const result = verifySignature(
        { provider: "slack", secret },
        payload,
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing signature header");
    });
  });

  describe("Custom Provider", () => {
    const secret = "custom_secret";
    const payload = JSON.stringify({ event: "test" });

    test("should verify valid custom signature", () => {
      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const headers = {
        [HTTP_HEADERS.CUSTOM_SIGNATURE.toLowerCase()]: signature,
      };

      const result = verifySignature(
        {
          provider: "custom",
          secret,
          headerName: "X-Custom-Signature",
          algorithm: "sha256",
        },
        payload,
        headers,
      );
      expect(result.valid).toBe(true);
    });

    test("should verify custom with timestampKey", () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const headers = {
        "x-custom-signature": signature,
        "x-custom-ts": ts,
      };

      const result = verifySignature(
        {
          provider: "custom",
          secret,
          headerName: "X-Custom-Signature",
          timestampKey: "X-Custom-Ts",
          tolerance: 60,
        },
        payload,
        headers,
      );
      expect(result.valid).toBe(true);
    });

    test("should reject custom with missing timestampKey header", () => {
      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const headers = { "x-custom-signature": signature };

      const result = verifySignature(
        {
          provider: "custom",
          secret,
          headerName: "X-Custom-Signature",
          timestampKey: "X-Custom-Ts",
        },
        payload,
        headers,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing timestamp header");
    });

    test("should reject custom with invalid signature header", () => {
      const result = verifySignature(
        { provider: "custom", secret, headerName: "X-Custom-Signature" },
        payload,
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing X-Custom-Signature header");
    });
  });

  describe("Streaming Verification", () => {
    const secret = "stream_secret";
    const payload = Buffer.from("streaming-data");

    test("should verify valid stream", async () => {
      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const headers = {
        [HTTP_HEADERS.CUSTOM_SIGNATURE.toLowerCase()]: signature,
      };
      const config = {
        provider: assertType("custom"),
        secret,
        headerName: "X-Custom-Signature",
      };

      const verifier = createStreamVerifier(config, headers);
      expect(verifier.hmac).toBeDefined();

      if (verifier.hmac) {
        verifier.hmac.update(payload);
      }
      const isValid = finalizeStreamVerification(verifier);
      expect(isValid).toBe(true);
    });

    test("should fail stream verification if secret is missing", () => {
      const verifier = createStreamVerifier(
        { provider: "custom", secret: "" },
        {},
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toContain("signing secret");
    });

    test("should fail stream if provider context has error", () => {
      const verifier = createStreamVerifier(
        { provider: "custom", secret: "test", headerName: "" },
        {},
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toContain("headerName");
    });

    test("should reject stream with expired timestamp", () => {
      const ts = String(Math.floor(Date.now() / 1000) - 500);
      const verifier = createStreamVerifier(
        {
          provider: "slack",
          secret: "test",
          tolerance: 60,
        },
        {
          [HTTP_HEADERS.SLACK_TIMESTAMP]: ts,
          [HTTP_HEADERS.SLACK_SIGNATURE]: "v0=abc",
        },
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toContain("tolerance");
    });

    test("should support stream with prefix (Slack)", () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const config = { provider: assertType("slack"), secret: "slack_secret" };
      const sig = createSlackSignature(ts, payload.toString(), config.secret);
      const headers = {
        [HTTP_HEADERS.SLACK_TIMESTAMP]: ts,
        [HTTP_HEADERS.SLACK_SIGNATURE]: sig,
      };

      const verifier = createStreamVerifier(config, headers);
      expect(verifier.hmac).toBeDefined();
      if (verifier.hmac) {
        verifier.hmac.update(payload);
      }
      expect(finalizeStreamVerification(verifier)).toBe(true);
    });

    test("finalizeStreamVerification should return false if hmac is null", () => {
      const isValid = finalizeStreamVerification({
        hmac: null,
        expectedSignature: "",
        encoding: "hex",
      });
      expect(isValid).toBe(false);
    });
  });

  describe("Edge Cases & Internal Helpers", () => {
    test("isTimestampWithinTolerance should handle invalid date formats", () => {
      // Internal function is not exported, but we test it via verifySignature
      const result = verifySignature(
        { provider: "shopify", secret: "test" },
        "{}",
        {
          [HTTP_HEADERS.SHOPIFY_HMAC_SHA256]: "abc",
          [HTTP_HEADERS.SHOPIFY_TRIGGERED_AT]: "not-a-date",
        },
      );
      // It should fall through to false in validateTimestamp
      expect(result.valid).toBe(false);
    });

    test("verifySignature should handle Buffer vs String payload", () => {
      const secret = "test";
      const payloadStr = "hello";
      const payloadBuf = Buffer.from(payloadStr);

      const sig = crypto
        .createHmac("sha256", secret)
        .update(payloadBuf)
        .digest("hex");
      const config = {
        provider: assertType("custom"),
        secret,
        headerName: "sig",
      };

      expect(verifySignature(config, payloadStr, { sig }).valid).toBe(true);
      expect(verifySignature(config, payloadBuf, { sig }).valid).toBe(true);
    });

    test("getProviderContext should catch internal errors", () => {
      // We can trigger an error by passing a provider that causes an exception in getProviderContext logic
      // e.g. if we somehow pass something that makes split() throw on headers
      const result = verifySignature(
        { provider: "stripe", secret: "test" },
        "{}",
        assertType(null), // This will make headers["stripe-signature"] throw if not careful
      );
      expect(result.valid).toBe(false);
    });

    test("should reject undefined secret", () => {
      const result = verifySignature(
        { provider: "stripe", secret: assertType(undefined) },
        "{}",
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("signing secret");
    });

    test("createStreamVerifier should catch crypto errors", () => {
      // Mocking crypto to throw is complex in ESM, but we can pass an invalid algorithm via custom provider
      const verifier = createStreamVerifier(
        {
          provider: "custom",
          secret: "test",
          headerName: "sig",
          algorithm: assertType("invalid-alg"),
        },
        { sig: "abc" },
      );
      expect(verifier.hmac).toBeNull();
      expect(verifier.error).toBeDefined();
    });

    test("SUPPORTED_PROVIDERS should be exported correctly", () => {
      expect(SUPPORTED_PROVIDERS).toContain("stripe");
      expect(SUPPORTED_PROVIDERS).toContain("shopify");
      expect(SUPPORTED_PROVIDERS).toContain("github");
      expect(SUPPORTED_PROVIDERS).toContain("slack");
      expect(SUPPORTED_PROVIDERS).toContain("custom");
    });

    test("should handle unknown provider", () => {
      const result = verifySignature(
        { provider: assertType("unknown"), secret: "test" },
        "{}",
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown provider");
    });

    test("should catch errors in getProviderContext", () => {
      // Logic inside getProviderContext might throw if we pass something that breaks .toLowerCase()
      // although we have defensive checks, we can force it by passing something unexpected if types are bypassed
      const result = verifySignature(
        { provider: "custom", secret: "test", headerName: assertType(null) },
        "{}",
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
