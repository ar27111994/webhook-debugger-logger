import { jest } from "@jest/globals";

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const request = (await import("supertest")).default;
const { app, webhookManager, initialize, shutdown } =
  await import("../src/main.js");
const { Actor } = await import("apify");

describe("Concurrency Tests", () => {
  let webhookId;

  beforeAll(async () => {
    await initialize();
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  beforeEach(() => {
    Actor.pushData.mockClear();
  });

  test("Should handle 50 concurrent webhook requests without data loss", async () => {
    const CONCURRENCY = 50;
    const initialCallCount = Actor.pushData.mock.calls.length;
    const promises = [];

    for (let i = 0; i < CONCURRENCY; i++) {
      promises.push(
        request(app)
          .post(`/webhook/${webhookId}`)
          .send({ index: i, timestamp: Date.now() }),
      );
    }

    const results = await Promise.all(promises);

    // Check all responses are 200
    results.forEach((res) => {
      expect(res.statusCode).toBe(200);
      expect(res.text).toBe("OK");
    });

    // Verify dataset push count in mock
    // Actor.pushData is called for each request
    // We expect the call count to increase by exactly CONCURRENCY
    expect(Actor.pushData.mock.calls.length - initialCallCount).toBe(
      CONCURRENCY,
    );
  });
});
