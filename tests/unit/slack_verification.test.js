import { verifySignature } from "../../src/utils/signature.js";
import { createSlackSignature } from "../setup/helpers/signature-utils.js";

/**
 * @typedef {import("../../src/typedefs.js").SignatureProvider} SignatureProvider
 */

describe("Slack Signature Verification", () => {
  // Values from Slack Documentation: https://api.slack.com/authentication/verifying-requests-from-slack
  const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
  const PAYLOAD =
    "token=xyzz0WbapA4vBCDEFasdf0q&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G877A82AL&channel_name=public-channel&user_id=U277AD99D&user_name=thiagocdn&command=%2Fweather&text=94070&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F165664413808%2FCASKDzzZo6hLi01tZpa6wbD";
  const PROVIDER = /** @type {SignatureProvider} */ ("slack");

  test("should verify valid signature (String Payload)", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createSlackSignature(timestamp, PAYLOAD, SECRET);

    const config = { provider: PROVIDER, secret: SECRET };
    const headers = {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe(PROVIDER);
  });

  test("should verify valid signature (Buffer Payload)", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createSlackSignature(timestamp, PAYLOAD, SECRET);

    const config = { provider: PROVIDER, secret: SECRET };
    const headers = {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    };

    const result = verifySignature(
      config,
      Buffer.from(PAYLOAD, "utf8"),
      headers,
    );
    expect(result.valid).toBe(true);
    expect(result.provider).toBe(PROVIDER);
  });

  test("should fail if timestamp is too old (Replay Attack)", () => {
    // 6 minutes ago
    const timestamp = (Math.floor(Date.now() / 1000) - 60 * 6).toString();
    const signature = createSlackSignature(timestamp, PAYLOAD, SECRET);

    const config = { provider: PROVIDER, secret: SECRET };
    const headers = {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Timestamp outside tolerance");
  });

  test("should fail if signature format is invalid (no v0=)", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createSlackSignature(timestamp, PAYLOAD, SECRET).replace(
      "v0=",
      "",
    );

    const config = { provider: PROVIDER, secret: SECRET };
    const headers = {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid signature format");
  });

  test("should fail if signature mismatch", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createSlackSignature(timestamp, PAYLOAD, SECRET);

    // Tamper with signature (ensure it's different)
    const lastChar = signature.slice(-1);
    const newChar = lastChar === "a" ? "b" : "a";
    const tampered = signature.substring(0, signature.length - 1) + newChar;

    const config = { provider: PROVIDER, secret: SECRET };
    const headers = {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": tampered,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Signature mismatch");
  });

  test("should fail if headers are missing", () => {
    const config = { provider: PROVIDER, secret: SECRET };
    const headers = /** @type {Record<string, string>} */ ({}); // Empty headers

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing Slack signature headers");
  });
});
