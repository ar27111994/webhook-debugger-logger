import { describe, test, expect } from "@jest/globals";
import crypto from "crypto";
import { verifySignature, SUPPORTED_PROVIDERS } from "../src/utils/signature.js";

describe("Signature Verification", () => {
  describe("Stripe", () => {
    const secret = "whsec_test_secret_key";
    const payload = JSON.stringify({ type: "payment_intent.succeeded", id: "pi_123" });

    function createStripeSignature(timestamp, payload, secret) {
      const signedPayload = `${timestamp}.${payload}`;
      const signature = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
      return `t=${timestamp},v1=${signature}`;
    }

    test("should verify valid Stripe signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const sigHeader = createStripeSignature(timestamp, payload, secret);
      const headers = { "stripe-signature": sigHeader };

      const result = verifySignature({ provider: "stripe", secret }, payload, headers);
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("stripe");
    });

    test("should reject invalid Stripe signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const sigHeader = createStripeSignature(timestamp, payload, "wrong_secret");
      const headers = { "stripe-signature": sigHeader };

      const result = verifySignature({ provider: "stripe", secret }, payload, headers);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("mismatch");
    });

    test("should reject expired Stripe timestamp", () => {
      const timestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      const sigHeader = createStripeSignature(timestamp, payload, secret);
      const headers = { "stripe-signature": sigHeader };

      const result = verifySignature({ provider: "stripe", secret, tolerance: 300 }, payload, headers);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("tolerance");
    });

    test("should reject missing Stripe-Signature header", () => {
      const result = verifySignature({ provider: "stripe", secret }, payload, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing");
    });
  });

  describe("Shopify", () => {
    const secret = "shopify_secret_key";
    const payload = JSON.stringify({ topic: "orders/create", id: "123" });

    function createShopifySignature(payload, secret) {
      return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("base64");
    }

    test("should verify valid Shopify signature", () => {
      const signature = createShopifySignature(payload, secret);
      const headers = { "x-shopify-hmac-sha256": signature };

      const result = verifySignature({ provider: "shopify", secret }, payload, headers);
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("shopify");
    });

    test("should reject invalid Shopify signature", () => {
      const headers = { "x-shopify-hmac-sha256": "invalid_signature" };

      const result = verifySignature({ provider: "shopify", secret }, payload, headers);
      expect(result.valid).toBe(false);
    });

    test("should reject missing Shopify header", () => {
      const result = verifySignature({ provider: "shopify", secret }, payload, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing");
    });
  });

  describe("GitHub", () => {
    const secret = "github_webhook_secret";
    const payload = JSON.stringify({ action: "opened", pull_request: {} });

    function createGitHubSignature(payload, secret) {
      const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
      return `sha256=${signature}`;
    }

    test("should verify valid GitHub signature", () => {
      const signature = createGitHubSignature(payload, secret);
      const headers = { "x-hub-signature-256": signature };

      const result = verifySignature({ provider: "github", secret }, payload, headers);
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("github");
    });

    test("should reject invalid GitHub signature", () => {
      const headers = { "x-hub-signature-256": "sha256=invalid" };

      const result = verifySignature({ provider: "github", secret }, payload, headers);
      expect(result.valid).toBe(false);
    });

    test("should reject missing GitHub header", () => {
      const result = verifySignature({ provider: "github", secret }, payload, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing");
    });
  });

  describe("Slack", () => {
    const secret = "slack_signing_secret";
    const payload = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J";

    function createSlackSignature(timestamp, payload, secret) {
      const sigBasestring = `v0:${timestamp}:${payload}`;
      const signature = crypto.createHmac("sha256", secret).update(sigBasestring).digest("hex");
      return `v0=${signature}`;
    }

    test("should verify valid Slack signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createSlackSignature(timestamp, payload, secret);
      const headers = {
        "x-slack-request-timestamp": String(timestamp),
        "x-slack-signature": signature,
      };

      const result = verifySignature({ provider: "slack", secret }, payload, headers);
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("slack");
    });

    test("should reject invalid Slack signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const headers = {
        "x-slack-request-timestamp": String(timestamp),
        "x-slack-signature": "v0=invalid",
      };

      const result = verifySignature({ provider: "slack", secret }, payload, headers);
      expect(result.valid).toBe(false);
    });

    test("should reject expired Slack timestamp", () => {
      const timestamp = Math.floor(Date.now() / 1000) - 400;
      const signature = createSlackSignature(timestamp, payload, secret);
      const headers = {
        "x-slack-request-timestamp": String(timestamp),
        "x-slack-signature": signature,
      };

      const result = verifySignature({ provider: "slack", secret, tolerance: 300 }, payload, headers);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("tolerance");
    });
  });

  describe("Custom Provider", () => {
    const secret = "custom_secret";
    const payload = JSON.stringify({ event: "test" });

    test("should verify valid custom signature", () => {
      const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
      const headers = { "x-custom-signature": signature };

      const result = verifySignature(
        { provider: "custom", secret, headerName: "X-Custom-Signature", algorithm: "sha256" },
        payload,
        headers
      );
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("custom");
    });

    test("should reject custom without headerName", () => {
      const result = verifySignature(
        { provider: "custom", secret },
        payload,
        {}
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("headerName");
    });
  });

  describe("Edge Cases", () => {
    test("should reject unknown provider", () => {
      // @ts-expect-error - testing invalid provider
      const result = verifySignature({ provider: "unknown", secret: "test" }, "{}", {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown provider");
    });

    test("should reject missing secret", () => {
      const result = verifySignature({ provider: "stripe", secret: "" }, "{}", {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("No signing secret");
    });

    test("SUPPORTED_PROVIDERS should include all providers", () => {
      expect(SUPPORTED_PROVIDERS).toContain("stripe");
      expect(SUPPORTED_PROVIDERS).toContain("shopify");
      expect(SUPPORTED_PROVIDERS).toContain("github");
      expect(SUPPORTED_PROVIDERS).toContain("slack");
      expect(SUPPORTED_PROVIDERS).toContain("custom");
    });
  });
});
