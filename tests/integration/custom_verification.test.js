import crypto from "crypto";
import { verifySignature } from "../../src/utils/signature.js";

/**
 * @typedef {import("../../src/typedefs.js").SignatureProvider} SignatureProvider
 * @typedef {import("../../src/typedefs.js").HashAlgorithm} HashAlgorithm
 * @typedef {import("../../src/typedefs.js").SignatureEncoding} SignatureEncoding
 */

describe("Custom Signature Verification", () => {
  const SECRET = "my-custom-secret";
  const PAYLOAD = "custom-payload-data";
  const HEADER_NAME = "x-custom-signature";
  const TIMESTAMP_HEADER = "x-custom-timestamp";
  const PROVIDER = /** @type {SignatureProvider} */ ("custom");

  test("should verify valid signature with sha256 (default)", () => {
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(PAYLOAD)
      .digest("hex");

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      algorithm: /** @type {HashAlgorithm} */ ("sha256"),
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe("custom");
  });

  test("should verify valid signature with sha1", () => {
    const signature = crypto
      .createHmac("sha1", SECRET)
      .update(PAYLOAD)
      .digest("hex");

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      algorithm: /** @type {HashAlgorithm} */ ("sha1"),
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
  });

  test("should fail if timestamp is too old (when timestampKey provided)", () => {
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(PAYLOAD)
      .digest("hex");

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      timestampKey: TIMESTAMP_HEADER, // Enable timestamp check
      tolerance: 300,
    };

    // 10 minutes ago
    const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();

    const headers = {
      [HEADER_NAME]: signature,
      [TIMESTAMP_HEADER]: staleTimestamp,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/^Timestamp outside tolerance/);
  });

  test("should verify valid signature with fresh timestamp", () => {
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(PAYLOAD)
      .digest("hex");

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      timestampKey: TIMESTAMP_HEADER,
      tolerance: 300,
    };

    const freshTimestamp = Math.floor(Date.now() / 1000).toString();

    const headers = {
      [HEADER_NAME]: signature,
      [TIMESTAMP_HEADER]: freshTimestamp,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
  });

  test("should fail if timestamp header is missing (when required)", () => {
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(PAYLOAD)
      .digest("hex");

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      timestampKey: TIMESTAMP_HEADER, // Required
    };

    const headers = {
      [HEADER_NAME]: signature,
      // Missing timestamp header
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing timestamp header");
  });

  test("should verify valid signature with base64 encoding", () => {
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(PAYLOAD)
      .digest("base64");

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      algorithm: /** @type {HashAlgorithm} */ ("sha256"),
      encoding: /** @type {SignatureEncoding} */ ("base64"),
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe("custom");
  });

  test("should fail if encoding mismatches (configured base64, sent hex)", () => {
    // Generate HEX
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(PAYLOAD)
      .digest("hex");

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      encoding: /** @type {SignatureEncoding} */ ("base64"), // Expecting Base64
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Signature mismatch");
  });
});
