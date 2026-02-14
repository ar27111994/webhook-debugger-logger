import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { setupTestApp } from "../setup/helpers/app-utils.js";
import {
  HTTP_STATUS,
  HTTP_HEADERS,
  MIME_TYPES,
} from "../../src/consts/index.js";

// Setup mocks
await setupCommonMocks({ apify: true, logger: true });

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Dashboard UI Integration", () => {
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

  test("should render the dashboard HTML page correctly", async () => {
    const res = await appClient
      .get("/")
      .expect(HTTP_STATUS.OK)
      .expect(HTTP_HEADERS.CONTENT_TYPE, /html/);

    // Verify presence of critical UI elements or tokens
    expect(res.text).toContain("Webhook Debugger, Logger & API Mocking Suite");
    expect(res.text).toContain("Active Webhooks");

    // Test for the version and other placeholders being replaced
    // We don't need to check exact version, etc., just that the placeholder {{VERSION}} is gone
    expect(res.text).not.toContain("{{VERSION}}");
    expect(res.text).not.toContain("{{ACTIVE_COUNT}}");
    expect(res.text).not.toContain("{{SIGNATURE_BADGE}}");
  });

  test("should support text/plain for machine-readable status", async () => {
    const res = await appClient
      .get("/")
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.TEXT)
      .expect(HTTP_STATUS.OK)
      .expect(HTTP_HEADERS.CONTENT_TYPE, /plain/);

    expect(res.text).toContain("Webhook Debugger, Logger & API Mocking Suite");
    expect(res.text).toContain("Active Webhooks:");
  });
});
