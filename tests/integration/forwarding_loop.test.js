import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { loggerMock } from "../setup/helpers/shared-mocks.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import {
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
  HTTP_STATUS,
} from "../../src/consts/index.js";

// Setup mocks first
await setupCommonMocks({ apify: true, logger: true });

const { setupTestApp } = await import("../setup/helpers/app-utils.js");
const { webhookManager } = await import("../../src/main.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 */

describe("Forwarding Loop Protection (Recursion)", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {string} */
  let webhookId;

  useMockCleanup();

  beforeAll(async () => {
    ({ appClient, teardownApp } = await setupTestApp());
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await teardownApp();
  });

  test(`should block request with matching ${RECURSION_HEADER_NAME}: ${RECURSION_HEADER_VALUE} header`, async () => {
    // Simulate a request that looks like it came from the ForwardingService
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set(RECURSION_HEADER_NAME, RECURSION_HEADER_VALUE)
      .send({ data: "loop" });

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({
      status: 422,
      error: "Unprocessable Entity",
      message: expect.stringContaining("Recursive forwarding detected"),
    });

    // Verify it was logged as a warning, not an error (since it's a handled protection)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId,
      }),
      "Recursive forwarding loop detected and blocked (Self-Reference).",
    );
  });

  test("should allow normal requests without the header", async () => {
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .send({ data: "normal" });

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
  });

  test("should block alternate check header if defined", async () => {
    // Future proofing: checking the secondary header we added just in case
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set(RECURSION_HEADER_NAME, `${RECURSION_HEADER_VALUE}-Loop-Check`)
      .send({ data: "loop-check" });

    expect(res.statusCode).toBe(422);
  });

  test("should ALLOW forwarding from a DIFFERENT actor instance (different Run ID)", async () => {
    // Simulate a request from another instance (e.g. valid multi-hop or staging -> prod)
    const otherRunId = "some-other-run-id";
    const res = await appClient
      .post(`/webhook/${webhookId}`)
      .set(RECURSION_HEADER_NAME, otherRunId)
      .send({ data: "valid-cross-instance-forward" });

    expect(res.statusCode).toBe(HTTP_STATUS.OK);
  });
});
