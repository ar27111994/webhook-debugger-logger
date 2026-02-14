import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { HTTP_STATUS, HTTP_HEADERS } from "../../src/consts/index.js";

// Setup mocks
await setupCommonMocks({ apify: true, logger: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");
const { webhookRateLimiter } =
  await import("../../src/utils/webhook_rate_limiter.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Distributed Rate Limiting (X-Forwarded-For)", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {string} */
  let webhookId;

  useMockCleanup();

  beforeAll(async () => {
    ({ appClient, teardownApp } = await setupTestApp());
    // Ensure app trusts proxies for X-Forwarded-For testing
    const { app } = await import("../../src/main.js");
    app.set("trust proxy", true);
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should handle distinct clients independently via X-Forwarded-For", async () => {
    // Spy on the check method to verify correct IP propagation
    const checkSpy = jest.spyOn(webhookRateLimiter, "check");

    // Client A: 1.2.3.4
    // Client B: 5.6.7.8
    // Both should be allowed up to the limit independently.

    const ipA = "1.2.3.4";
    const ipB = "5.6.7.8";

    // Fire a request from A
    await appClient
      .post(`/webhook/${webhookId}`)
      .set(HTTP_HEADERS.X_FORWARDED_FOR, ipA)
      .send({ data: "A" })
      .expect(HTTP_STATUS.OK);

    // Verify check called with IP A
    expect(checkSpy).toHaveBeenCalledWith(webhookId, ipA);

    // Fire a request from B
    await appClient
      .post(`/webhook/${webhookId}`)
      .set(HTTP_HEADERS.X_FORWARDED_FOR, ipB)
      .send({ data: "B" })
      .expect(HTTP_STATUS.OK);

    // Verify check called with IP B
    expect(checkSpy).toHaveBeenCalledWith(webhookId, ipB);

    checkSpy.mockRestore();
  });

  test("should interpret X-Forwarded-For correctly (left-most IP)", async () => {
    const checkSpy = jest.spyOn(webhookRateLimiter, "check");

    // Standard proxy chain: Client <-> Proxy1 <-> Proxy2 <-> App
    // Header: Client, Proxy1, Proxy2
    // req.ip should be "Client"

    const clientIp = "203.0.113.1";
    const proxyChain = `${clientIp}, 198.51.100.1, 10.0.0.1`;

    await appClient
      .post(`/webhook/${webhookId}`)
      .set(HTTP_HEADERS.X_FORWARDED_FOR, proxyChain)
      .send({ data: "proxy-chain" })
      .expect(HTTP_STATUS.OK);

    // Verify correct IP was extracted
    expect(checkSpy).toHaveBeenCalledWith(webhookId, clientIp);

    checkSpy.mockRestore();
  });
});
