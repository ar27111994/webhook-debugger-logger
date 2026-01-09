import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";

// Mock DNS to control IP resolution
jest.unstable_mockModule("dns/promises", () => ({
  default: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
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

const request = (await import("supertest")).default;
const dns = (await import("dns/promises")).default;
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
    jest.mocked(dns.resolve4).mockReset();
    jest.mocked(dns.resolve6).mockReset();

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
    jest.mocked(Actor.openDataset).mockResolvedValue(
      /** @type {any} */ ({
        getData: jest.fn(async () => ({ items: [mockItem] })),
      }),
    );
  });

  describe("/replay SSRF Protection", () => {
    test("should reject non-http/https protocols (ftp://)", async () => {
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "ftp://evil.com/malware" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("Only http/https URLs are allowed");
    });

    test("should reject non-http/https protocols (file://)", async () => {
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "file:///etc/passwd" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("Only http/https URLs are allowed");
    });

    test("should reject IP literal in loopback range (127.0.0.1)", async () => {
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://127.0.0.1/admin" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("URL resolves to internal/reserved IP range");
    });

    test("should reject IP literal in private range (192.168.1.1)", async () => {
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://192.168.1.1/secret" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("URL resolves to internal/reserved IP range");
    });

    test("should reject IP literal in cloud metadata range (169.254.169.254)", async () => {
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://169.254.169.254/latest/meta-data/" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("URL resolves to internal/reserved IP range");
    });

    test("should reject hostname resolving to internal IP", async () => {
      jest.mocked(dns.resolve4).mockResolvedValue(["10.0.0.1"]);
      jest.mocked(dns.resolve6).mockRejectedValue(new Error("No AAAA record"));

      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://internal.corp.example/" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("URL resolves to internal/reserved IP range");
    });

    test("should reject when DNS resolution fails completely", async () => {
      jest.mocked(dns.resolve4).mockRejectedValue(new Error("NXDOMAIN"));
      jest.mocked(dns.resolve6).mockRejectedValue(new Error("NXDOMAIN"));

      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://nonexistent.invalid/" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("Unable to resolve hostname for 'url'");
    });

    test("should reject invalid URL", async () => {
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "not-a-valid-url" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("Invalid URL format");
    });

    test("should reject IPv6 loopback (::1)", async () => {
      const res = await request(app)
        .get(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://[::1]/admin" })
        .set("Authorization", "Bearer test-secret");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("URL resolves to internal/reserved IP range");
    });
  });
});
