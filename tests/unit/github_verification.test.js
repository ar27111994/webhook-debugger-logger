import { SIGNATURE_PREFIXES, SIGNATURE_PROVIDERS } from "../../src/consts/security.js";
import { ENCODINGS, HTTP_HEADERS } from "../../src/consts/http.js";
import { verifySignature } from "../../src/utils/signature.js";
import { createGitHubSignature } from "../setup/helpers/signature-utils.js";
import { SIGNATURE_ERRORS } from "../../src/consts/errors.js";

/**
 * @typedef {import("../../src/typedefs.js").SignatureProvider} SignatureProvider
 */

describe("GitHub Signature Verification", () => {
  // Values from GitHub Documentation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
  /** @type {SignatureProvider} */
  const PROVIDER = SIGNATURE_PROVIDERS.GITHUB;
  const DOC_SECRET = "It's a Secret to Everybody";
  const DOC_PAYLOAD = "Hello, World!";
  const DOC_SIGNATURE =
    "757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

  test("should verify correctly using the example from GitHub docs (String Payload)", () => {
    const config = {
      provider: PROVIDER,
      secret: DOC_SECRET,
    };
    const headers = {
      [HTTP_HEADERS.HUB_SIGNATURE_256]: `${SIGNATURE_PREFIXES.SHA256}${DOC_SIGNATURE}`,
    };

    const result = verifySignature(config, DOC_PAYLOAD, headers);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe(PROVIDER);
  });

  test("should verify correctly using the example from GitHub docs (Buffer Payload)", () => {
    const config = {
      provider: PROVIDER,
      secret: DOC_SECRET,
    };
    const headers = {
      [HTTP_HEADERS.HUB_SIGNATURE_256]: `${SIGNATURE_PREFIXES.SHA256}${DOC_SIGNATURE}`,
    };
    const payloadBuffer = Buffer.from(DOC_PAYLOAD, ENCODINGS.UTF8);

    const result = verifySignature(config, payloadBuffer, headers);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe(PROVIDER);
  });

  test("should fail if signature is tampered", () => {
    const config = { provider: PROVIDER, secret: DOC_SECRET };
    const headers = {
      [HTTP_HEADERS.HUB_SIGNATURE_256]: `${SIGNATURE_PREFIXES.SHA256}${DOC_SIGNATURE.replace("7", "8")}`,
    };

    const result = verifySignature(config, DOC_PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(SIGNATURE_ERRORS.MISMATCH);
  });

  test("should fail if payload is modified", () => {
    const config = { provider: PROVIDER, secret: DOC_SECRET };
    const headers = {
      [HTTP_HEADERS.HUB_SIGNATURE_256]: `${SIGNATURE_PREFIXES.SHA256}${DOC_SIGNATURE}`,
    };

    const result = verifySignature(config, "Hello, World", headers); // Missing "!"
    expect(result.valid).toBe(false);
  });

  test("should fail if header prefix is missing", () => {
    const config = { provider: PROVIDER, secret: DOC_SECRET };
    const headers = {
      [HTTP_HEADERS.HUB_SIGNATURE_256]: DOC_SIGNATURE, // Missing "sha256="
    };
    const result = verifySignature(config, DOC_PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(SIGNATURE_ERRORS.INVALID_FORMAT);
  });

  test("should handle unicode characters correctly", () => {
    const secret = "my_secret";
    const payload = "Hello 🌍"; // Unicode emoji
    const signature = createGitHubSignature(payload, secret);

    const config = { provider: PROVIDER, secret };
    const headers = { [HTTP_HEADERS.HUB_SIGNATURE_256]: signature };

    // Test with string
    const resultString = verifySignature(config, payload, headers);
    expect(resultString.valid).toBe(true);

    // Test with Buffer
    const resultBuffer = verifySignature(
      config,
      Buffer.from(payload, ENCODINGS.UTF8),
      headers,
    );
    expect(resultBuffer.valid).toBe(true);
  });
});
