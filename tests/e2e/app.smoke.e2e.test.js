/**
 * @file tests/e2e/app.smoke.e2e.test.js
 * @description Black-box e2e smoke tests using spawned process harness.
 */

import {
  findFreePort,
  httpRequest,
  spawnAppProcess,
} from "../setup/helpers/e2e-process-harness.js";
import { APP_ROUTES } from "../../src/consts/app.js";
import {
  HTTP_CONSTS,
  HTTP_HEADERS,
  HTTP_STATUS,
} from "../../src/consts/http.js";

/**
 * @typedef {import('../setup/helpers/e2e-process-harness.js').SpawnedApp} SpawnedApp
 */

describe("E2E: Spawned app smoke", () => {
  /** @type {SpawnedApp | null} */
  let appProcess = null;

  afterEach(async () => {
    if (appProcess) {
      await appProcess.stop();
      appProcess = null;
    }
  });

  it("should start process and serve health endpoint", async () => {
    const port = await findFreePort();
    appProcess = await spawnAppProcess({
      port,
      input: {
        urlCount: 1,
        retentionHours: 1,
        authKey: "e2e-secret",
      },
    });

    const response = await httpRequest(
      `${appProcess.baseUrl}${APP_ROUTES.HEALTH}`,
    );

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(response.bodyText.length).toBeGreaterThan(0);
  });

  it("should enforce auth on info endpoint and allow readiness bypass", async () => {
    const port = await findFreePort();
    appProcess = await spawnAppProcess({
      port,
      input: {
        urlCount: 1,
        retentionHours: 1,
        authKey: "e2e-secret",
      },
    });

    const unauthorized = await httpRequest(
      `${appProcess.baseUrl}${APP_ROUTES.INFO}`,
    );
    const authorized = await httpRequest(
      `${appProcess.baseUrl}${APP_ROUTES.INFO}`,
      "GET",
      {
        [HTTP_HEADERS.AUTHORIZATION]: "Bearer e2e-secret",
      },
    );
    const readinessBypass = await httpRequest(
      `${appProcess.baseUrl}${APP_ROUTES.INFO}`,
      "GET",
      {
        [HTTP_HEADERS.APIFY_READINESS]: "true",
      },
    );

    expect(unauthorized.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(authorized.statusCode).toBe(HTTP_STATUS.OK);
    expect(readinessBypass.statusCode).toBe(HTTP_CONSTS.DEFAULT_RESPONSE_CODE);
    expect(readinessBypass.bodyText).toBe(HTTP_CONSTS.DEFAULT_SUCCESS_BODY);
  });
});
