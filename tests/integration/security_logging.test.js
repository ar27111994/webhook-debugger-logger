import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks, loggerMock } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";

// Setup mocks
await setupCommonMocks({
  apify: true,
  logger: true,
  config: true, // Reuse default config
});

const { setupTestApp } = await import("../setup/helpers/app-utils.js");

// We need to set a known auth key to test auth failure vs success
const SENSITIVE_TOKEN = "super-secret-token-12345";
const VALID_KEY = "valid-api-key";

// Override input for this test
import { apifyMock } from "../setup/helpers/shared-mocks.js";
apifyMock.getInput.mockResolvedValue({
  authKey: VALID_KEY,
});

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Security Logging", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  useMockCleanup();

  beforeAll(async () => {
    ({ appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should NOT log the Authorization bearer token on auth failure", async () => {
    // Send request with invalid token
    const res = await appClient
      .get("/info")
      .set("Authorization", `Bearer ${SENSITIVE_TOKEN}`);

    expect(res.status).toBe(401);

    // Scan all log calls for the sensitive token
    const allLogCalls = [
      ...loggerMock.info.mock.calls,
      ...loggerMock.warn.mock.calls,
      ...loggerMock.error.mock.calls,
      ...loggerMock.debug.mock.calls,
    ];

    const stringifiedLogs = JSON.stringify(allLogCalls);

    // The token should NOT be present in logs
    expect(stringifiedLogs).not.toContain(SENSITIVE_TOKEN);
  });

  test("should NOT log the Authorization bearer token in request logger (LoggerMiddleware)", async () => {
    // Even on success, headers shouldn't leak if redacted or handled carefully
    const res = await appClient
      .get("/info")
      .set("Authorization", `Bearer ${VALID_KEY}`);

    expect(res.status).toBe(200);

    const allLogCalls = [
      ...loggerMock.info.mock.calls,
      ...loggerMock.debug.mock.calls,
    ];
    const stringifiedLogs = JSON.stringify(allLogCalls);

    // The valid key should not be in logs either (unless explicitly desired, but usually bad practice)
    expect(stringifiedLogs).not.toContain(VALID_KEY);
  });
});
