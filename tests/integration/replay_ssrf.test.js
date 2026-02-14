import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";

import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, dns: true });

import {
  dnsPromisesMock as mockDns,
  createDatasetMock,
} from "../setup/helpers/shared-mocks.js";
const { sleep } = await import("../setup/helpers/test-utils.js");
const request = (await import("supertest")).default;
const {
  HTTP_STATUS,
  SSRF_ERRORS,
  ERROR_MESSAGES,
  HTTP_METHODS,
  HTTP_HEADERS,
  MIME_TYPES,
} = await import("../../src/consts/index.js");
const { app, initialize, shutdown, webhookManager } =
  await import("../../src/main.js");
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
      method: HTTP_METHODS.POST,
      headers: { [HTTP_HEADERS.CONTENT_TYPE]: MIME_TYPES.JSON },
      body: '{"test": "data"}',
      timestamp: new Date().toISOString(),
      statusCode: HTTP_STATUS.OK,
    };
    jest
      .mocked(Actor.openDataset)
      .mockResolvedValue(createDatasetMock([mockItem]));
  });

  describe("/replay SSRF Protection", () => {
    const validAuth = "Bearer test-secret";

    test("should reject non-http/https protocols (ftp://)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "ftp://example.com" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.PROTOCOL_NOT_ALLOWED);
    });

    test("should reject non-http/https protocols (file://)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "file:///etc/passwd" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.PROTOCOL_NOT_ALLOWED);
    });

    test("should reject IP literal in loopback range (127.0.0.1)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://127.0.0.1/admin" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject IP literal in private range (192.168.1.1)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://192.168.1.1/config" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject IP literal in cloud metadata range (169.254.169.254)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://169.254.169.254/latest/meta-data" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject hostname resolving to internal IP", async () => {
      mockDns.resolve4.mockResolvedValue(["10.0.0.1"]);
      mockDns.resolve6.mockRejectedValue(new Error("No AAAA record"));

      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://internal.corp.example/" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject when DNS resolution fails completely", async () => {
      mockDns.resolve4.mockRejectedValue(new Error("NXDOMAIN"));
      mockDns.resolve6.mockRejectedValue(new Error("NXDOMAIN"));

      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://nonexistent.invalid/" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED);
    });

    test("should reject invalid URL", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "not-a-valid-url" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.INVALID_URL);
    });

    test("should reject IPv6 loopback (::1)", async () => {
      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://[::1]/admin" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.INTERNAL_IP);
    });

    test("should reject when DNS resolution times out", async () => {
      // Mock slow DNS resolution
      mockDns.resolve4.mockImplementation(async () => {
        await sleep(6000); // > 5000ms
        return ["1.2.3.4"];
      });
      mockDns.resolve6.mockImplementation(async () => {
        await sleep(6000);
        return ["2001:db8::1"];
      });

      const res = await request(app)
        .post(`/replay/${webhookId}/evt_test`)
        .query({ url: "http://example.com/slow" })
        .set(HTTP_HEADERS.AUTHORIZATION, validAuth);

      expect(res.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(res.body.error).toBe(SSRF_ERRORS.VALIDATION_FAILED);
    }, 10000); // Increase timeout for this specific test
  });
});
