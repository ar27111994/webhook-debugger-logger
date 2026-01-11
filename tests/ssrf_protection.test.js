import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";

/** @typedef {typeof import("./helpers/shared-mocks.js").dnsPromisesMock} DnsPromisesMock */

const mockDns = /** @type {DnsPromisesMock} */ ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
});

// Mock DNS to control IP resolution
jest.unstable_mockModule("dns/promises", () => ({
  default: mockDns,
}));

// Mock Apify and axios
jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

jest.unstable_mockModule("axios", async () => {
  const { axiosMock } = await import("./helpers/shared-mocks.js");
  return { default: axiosMock };
});

const { createDatasetMock } = await import("./helpers/shared-mocks.js");
const request = (await import("supertest")).default;
const { SSRF_ERRORS } = await import("../src/utils/ssrf.js");
const { ERROR_MESSAGES } = await import("../src/consts.js");
const { app, initialize, shutdown, webhookManager } =
  await import("../src/main.js");
const { Actor } = await import("apify");

describe("SSRF Protection Tests", () => {
  /** @type {string} */
  let webhookId;

  beforeAll(async () => {
    jest.mocked(Actor.getInput).mockResolvedValue({ authKey: "test-secret" });
    await initialize();
    const ids = await webhookManager.generateWebhooks(1, 1);
    webhookId = ids[0];
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  beforeEach(() => {
    // Reset DNS mocks to default behavior for test isolation
    mockDns.resolve4.mockReset();
    mockDns.resolve6.mockReset();

    // Setup mock dataset with an event
    const mockItem = {
      id: "evt_test",
      webhookId,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"test": "data"}',
      timestamp: new Date().toISOString(),
      statusCode: 200,
    };
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(/** @type {any} */ (createDatasetMock([mockItem])));
  });

  describe("/replay SSRF Protection", () => {
    const validAuth = "Bearer test-secret";

    test("should reject non-http/https protocols (ftp://)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "ftp://example.com" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.PROTOCOL_NOT_ALLOWED);
    });

    test("should reject non-http/https protocols (file://)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "file:///etc/passwd" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.PROTOCOL_NOT_ALLOWED);
    });

    test("should reject IP literal in loopback range (127.0.0.1)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://127.0.0.1/admin" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject IP literal in private range (192.168.1.1)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://192.168.1.1/config" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject IP literal in cloud metadata range (169.254.169.254)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://169.254.169.254/latest/meta-data" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject hostname resolving to internal IP", async () => {
      mockDns.resolve4.mockResolvedValue(["10.0.0.1"]);
      mockDns.resolve6.mockRejectedValue(new Error("No AAAA record"));

      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://internal.corp.example/" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject when DNS resolution fails completely", async () => {
      mockDns.resolve4.mockRejectedValue(new Error("NXDOMAIN"));
      mockDns.resolve6.mockRejectedValue(new Error("NXDOMAIN"));

      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://nonexistent.invalid/" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED);
    });

    test("should reject invalid URL", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "not-a-valid-url" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.INVALID_URL);
    });

    test("should reject IPv6 loopback (::1)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://[::1]/admin" })
        .set("Authorization", validAuth);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });
  });
});
