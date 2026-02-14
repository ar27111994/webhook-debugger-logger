import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../../package.json");

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
import { MIME_TYPES, HTTP_HEADERS } from "../../src/consts/index.js";

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("UI & Landing Page Tests", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  beforeAll(async () => {
    ({ appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("GET / should return professional HTML landing page for browsers", async () => {
    const res = await appClient
      .get("/")
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.HTML);

    expect(res.statusCode).toBe(200);
    expect(res.headers[HTTP_HEADERS.CONTENT_TYPE]).toContain(MIME_TYPES.HTML);
    expect(res.text).toContain("Webhook Debugger");
    expect(res.text).toContain(`v${version}`);
    expect(res.text).not.toContain("{{ACTIVE_COUNT}}");
    expect(res.text).not.toContain("{{VERSION}}"); // Ensure all placeholders are replaced
    expect(res.text).toContain("System Online");

    const activeCount = webhookManager.getAllActive().length;
    expect(res.text).toContain(String(activeCount));
  });

  test("GET / should return plain text for non-browser clients", async () => {
    const res = await appClient
      .get("/")
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.TEXT);

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Webhook Debugger");
    expect(res.text).not.toContain("<!DOCTYPE html>");
  });

  test("Readiness probe should return 200 OK", async () => {
    const res = await appClient.get("/").set(HTTP_HEADERS.APIFY_READINESS, "1");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });
});
