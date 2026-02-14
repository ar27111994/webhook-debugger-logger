import { describe, test, beforeAll, afterAll } from "@jest/globals";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import { HTTP_STATUS, HTTP_HEADERS } from "../../src/consts/index.js";
import { useMockCleanup } from "../setup/helpers/test-lifecycle.js";
import { sleep } from "../setup/helpers/test-utils.js";
import {
  apifyMock,
  setupBasicApifyMock,
} from "../setup/helpers/shared-mocks.js";

// Setup mocks - Use defaults but we explicitly want HotReloadManager to be REAL
// setupCommonMocks defaults hotReload: false (so real module is used)
await setupCommonMocks({
  apify: true,
  logger: true,
  // ensure other components are real where possible for E2E feel
  hotReload: false,
});

const { setupTestApp } = await import("../setup/helpers/app-utils.js");

/**
 * @typedef {import("../setup/helpers/app-utils.js").AppClient} AppClient
 * @typedef {import("../setup/helpers/app-utils.js").TeardownApp} TeardownApp
 * @typedef {import("../../src/typedefs.js").LogEntry} LogEntry
 * @typedef {import("../setup/helpers/shared-mocks.js").KeyValueStoreMock} KeyValueStoreMock
 */

describe("Hot Reload E2E - Dynamic Config Updates", () => {
  /** @type {AppClient} */
  let appClient;
  /** @type {TeardownApp} */
  let teardownApp;
  /** @type {KeyValueStoreMock} */
  let kvStoreMock;

  useMockCleanup();

  beforeAll(async () => {
    // 1. Setup KV Store Mock to return initial config
    // We access the singleton mock used by the app
    const { kvStore } = setupBasicApifyMock(apifyMock, {
      input: {
        authKey: "initial-secret",
        defaultResponseCode: HTTP_STATUS.OK,
      },
    });
    kvStoreMock = kvStore;

    ({ appClient, teardownApp } = await setupTestApp());
  });

  afterAll(async () => {
    await teardownApp();
  });

  test("should dynamically update authKey from INPUT without restart", async () => {
    // Step 1: Verify Initial Config
    // Should succeed with initial key
    await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer initial-secret")
      .expect(HTTP_STATUS.OK);

    // Should fail with future key
    await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer new-secret")
      .expect(HTTP_STATUS.UNAUTHORIZED);

    // Step 2: Update Input in KV Store (Simulate external update)
    kvStoreMock.getValue.mockResolvedValue({
      authKey: "new-secret",
      defaultResponseCode: HTTP_STATUS.CREATED, // Changing another prop to be sure
    });

    // Step 3: Wait for Hot Reload Poll Interval
    // Interval is likely 100ms in test (INPUT_POLL_INTERVAL_TEST_MS)
    await sleep(300);

    // Step 4: Verify New Config
    // Old key should now fail
    await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer initial-secret")
      .expect(HTTP_STATUS.UNAUTHORIZED);

    // New key should succeed
    await appClient
      .get("/info")
      .set(HTTP_HEADERS.AUTHORIZATION, "Bearer new-secret")
      .expect(HTTP_STATUS.OK);
  });
});
