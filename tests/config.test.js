import { describe, test, expect } from "@jest/globals";
import {
  parseWebhookOptions,
  DEFAULT_MAX_PAYLOAD_SIZE,
} from "../src/utils/config.js";

describe("Config Utils", () => {
  test("parseWebhookOptions should clamp maxPayloadSize to default maximum", () => {
    // Test capping at default
    const huge = DEFAULT_MAX_PAYLOAD_SIZE + 10000;
    const opts = parseWebhookOptions({ maxPayloadSize: huge });
    expect(opts.maxPayloadSize).toBe(DEFAULT_MAX_PAYLOAD_SIZE);

    // Test valid small size
    const small = 1024;
    const opts2 = parseWebhookOptions({ maxPayloadSize: small });
    expect(opts2.maxPayloadSize).toBe(small);

    // Test invalid input (non-number)
    const opts3 = parseWebhookOptions({ maxPayloadSize: "invalid" });
    expect(opts3.maxPayloadSize).toBe(DEFAULT_MAX_PAYLOAD_SIZE);

    // Test negative input
    const opts4 = parseWebhookOptions({ maxPayloadSize: -100 });
    expect(opts4.maxPayloadSize).toBe(DEFAULT_MAX_PAYLOAD_SIZE);
  });
});
