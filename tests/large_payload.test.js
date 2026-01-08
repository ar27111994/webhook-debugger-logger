import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

// Mock axios
jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

// Mock Apify
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const request = (await import("supertest")).default;
const { app, webhookManager, initialize, shutdown } = await import(
  "../src/main.js"
);

describe("Large Payload Stability", () => {
  beforeAll(async () => {
    await initialize();
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("Should handle 10MB payload", async () => {
    // Generate a valid ID dynamically or use one from manager
    const [webhookId] = await webhookManager.generateWebhooks(1, 1);
    const largeBody = "a".repeat(10 * 1024 * 1024); // 10MB

    const res = await request(app)
      .post(`/webhook/${webhookId}`)
      .set("Content-Type", "text/plain")
      .send(largeBody);

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  }, 30000); // 30s timeout for large payload
});
