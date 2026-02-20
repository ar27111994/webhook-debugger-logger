import crypto from "crypto";
import { verifySignature } from "../../src/utils/signature.js";
import { HASH_ALGORITHMS, SIGNATURE_CONSTS, SIGNATURE_ENCODINGS, SIGNATURE_PROVIDERS } from "../../src/consts/security.js";
import { assertType } from "../setup/helpers/test-utils.js";
import { APP_CONSTS } from "../../src/consts/app.js";
import { SIGNATURE_ERRORS } from "../../src/consts/errors.js";

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
  /** @type {SignatureProvider} */
  const PROVIDER = SIGNATURE_PROVIDERS.CUSTOM;

  test("should verify valid signature with sha256 (default)", () => {
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
    const signature = crypto
      .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
      .update(PAYLOAD)
      .digest(assertType(SIGNATURE_ENCODINGS.HEX));

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      algorithm: HASH_ALGORITHMS.SHA256,
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe(PROVIDER);
  });

  test("should verify valid signature with sha1", () => {
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
    const signature = crypto
      .createHmac(HASH_ALGORITHMS.SHA1, SECRET)
      .update(PAYLOAD)
      .digest(assertType(SIGNATURE_ENCODINGS.HEX));

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      algorithm: HASH_ALGORITHMS.SHA1,
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
  });

  test("should fail if timestamp is too old (when timestampKey provided)", () => {
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
    const signature = crypto
      .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
      .update(PAYLOAD)
      .digest(assertType(SIGNATURE_ENCODINGS.HEX));

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      timestampKey: TIMESTAMP_HEADER, // Enable timestamp check
      tolerance: SIGNATURE_CONSTS.TOLERANCE_SECONDS,
    };

    // 10 minutes ago
    const tenMinutesInSeconds = 600;
    const staleTimestamp = (Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND) - tenMinutesInSeconds).toString();

    const headers = {
      [HEADER_NAME]: signature,
      [TIMESTAMP_HEADER]: staleTimestamp,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(SIGNATURE_ERRORS.TIMESTAMP_TOLERANCE);
  });

  test("should verify valid signature with fresh timestamp", () => {
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
    const signature = crypto
      .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
      .update(PAYLOAD)
      .digest(assertType(SIGNATURE_ENCODINGS.HEX));

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      timestampKey: TIMESTAMP_HEADER,
      tolerance: SIGNATURE_CONSTS.TOLERANCE_SECONDS,
    };

    const freshTimestamp = Math.floor(Date.now() / APP_CONSTS.MS_PER_SECOND).toString();

    const headers = {
      [HEADER_NAME]: signature,
      [TIMESTAMP_HEADER]: freshTimestamp,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
  });

  test("should fail if timestamp header is missing (when required)", () => {
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
    const signature = crypto
      .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
      .update(PAYLOAD)
      .digest(assertType(SIGNATURE_ENCODINGS.HEX));

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
    expect(result.error).toContain(SIGNATURE_ERRORS.MISSING_TIMESTAMP);
  });

  test("should verify valid signature with base64 encoding", () => {
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
    const signature = crypto
      .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
      .update(PAYLOAD)
      .digest(assertType(SIGNATURE_ENCODINGS.BASE64));

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      algorithm: HASH_ALGORITHMS.SHA256,
      encoding: SIGNATURE_ENCODINGS.BASE64,
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe(PROVIDER);
  });

  test("should fail if encoding mismatches (configured base64, sent hex)", () => {
    // Generate HEX
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures
    const signature = crypto
      .createHmac(HASH_ALGORITHMS.SHA256, SECRET)
      .update(PAYLOAD)
      .digest(assertType(SIGNATURE_ENCODINGS.HEX));

    const config = {
      provider: PROVIDER,
      secret: SECRET,
      headerName: HEADER_NAME,
      encoding: SIGNATURE_ENCODINGS.BASE64, // Expecting Base64
    };

    const headers = {
      [HEADER_NAME]: signature,
    };

    const result = verifySignature(config, PAYLOAD, headers);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(SIGNATURE_ERRORS.MISMATCH);
  });
});
