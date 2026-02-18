import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  HTTP_STATUS,
  MIME_TYPES,
  HTTP_HEADERS,
  ENV_VARS,
} from "../../src/consts/index.js";
await setupCommonMocks({ apify: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { Actor } = await import("apify");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Auth UI Hardening Tests", () => {
  const authKey = "secret-ui-key";

  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;

  beforeAll(async () => {
    // Prevent INPUT env var from polluting tests
    delete process.env[ENV_VARS.INPUT];

    jest.mocked(Actor.getInput).mockResolvedValue({
      authKey,
      urlCount: 1,
    });
    ({ appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should allow readiness probe without auth", async () => {
    const res = await appClient
      .get("/")
      .set("x-apify-container-server-readiness-probe", "true");

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.text).toBe("OK");
  });

  test("should show 'Locked' HTML for browser unauthorized access", async () => {
    const res = await appClient
      .get("/")
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.HTML);

    expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(res.text).toContain("401 Unauthorized");
    expect(res.text).toContain("Strict Mode");
  });

  test("should return JSON HTTP_STATUS.UNAUTHORIZED for non-browser unauthorized access", async () => {
    const res = await appClient.get("/");

    expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("should allow access but NOT propagate key in links when authenticated via query", async () => {
    const res = await appClient
      .get("/")
      .query({ key: authKey })
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.HTML);

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.text).toContain("Webhook Debugger, Logger & API Mocking Suite");
    // Verify NO link propagation (Security requirement)
    expect(res.text).not.toContain(`?key=${authKey}`);
    expect(res.text).toContain('href="/info"');
  });

  test("should allow access but NOT propagate key when authenticated via Bearer header", async () => {
    const res = await appClient
      .get("/")
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${authKey}`)
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.HTML);

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.text).toContain("Webhook Debugger, Logger & API Mocking Suite");
    expect(res.text).not.toContain(authKey);
    expect(res.text).toContain('href="/info"');
  });

  test("should NOT leak key in /info JSON response when authed via header", async () => {
    const res = await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${authKey}`);

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.endpoints.logs).not.toContain("key=");
    expect(res.body.endpoints.info).not.toContain("key=");
    expect(res.body.endpoints.webhook).not.toContain("key=");
  });

  test("should NOT leak key in /info JSON response when authed via query", async () => {
    const res = await appClient.get("/info").query({ key: authKey });

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
    expect(res.body.endpoints.logs).not.toContain("key=");
    expect(res.body.endpoints.webhook).not.toContain("key=");
    expect(res.body.endpoints.info).not.toContain("key=");
  });

  test("should reject /info access without any auth", async () => {
    const res = await appClient.get("/info");
    expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("should reject /info access with invalid key", async () => {
    const res = await appClient.get("/info").query({ key: "wrong-key" });
    expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("should show 'Locked' HTML for malformed auth key in query", async () => {
    const res = await appClient
      .get("/")
      .query({ key: "malformed-key" })
      .set(HTTP_HEADERS.ACCEPT, MIME_TYPES.HTML);

    expect(res.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(res.text).toContain("Please check your API key");
    expect(res.text).toContain("Strict Mode");
    expect(res.text).not.toContain("Webhook Debugger Dashboard");
  });
});
