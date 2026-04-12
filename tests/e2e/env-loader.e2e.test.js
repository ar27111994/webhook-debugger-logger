/**
 * @file tests/e2e/env-loader.e2e.test.js
 * @description Black-box e2e coverage for local .env-driven boot behavior.
 */

import { jest } from "@jest/globals";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findFreePort,
  httpRequest,
  spawnAppProcess,
} from "../setup/helpers/e2e-process-harness.js";
import { APP_ROUTES, ENV_VARS } from "../../src/consts/app.js";
import { AUTH_CONSTS } from "../../src/consts/auth.js";
import { ENCODINGS, HTTP_HEADERS, HTTP_STATUS } from "../../src/consts/http.js";

/**
 * @typedef {import('../setup/helpers/e2e-process-harness.js').SpawnedApp} SpawnedApp
 */

const AUTH_KEY = "env-e2e-secret";
const E2E_TEST_TIMEOUT_MS = 20000;

jest.setTimeout(E2E_TEST_TIMEOUT_MS);

describe("E2E: Local .env loader", () => {
  /** @type {SpawnedApp | null} */
  let appProcess = null;
  /** @type {string | null} */
  let tempCwd = null;

  afterEach(async () => {
    if (appProcess) {
      await appProcess.stop();
      appProcess = null;
    }

    if (tempCwd) {
      await rm(tempCwd, { recursive: true, force: true });
      tempCwd = null;
    }
  });

  it("should boot from a cwd .env file without explicit process env overrides", async () => {
    const port = await findFreePort();
    tempCwd = await mkdtemp(path.join(tmpdir(), "wdl-env-e2e-"));

    await writeFile(
      path.join(tempCwd, ".env"),
      [
        `${ENV_VARS.ACTOR_WEB_SERVER_PORT}=${port}`,
        `${ENV_VARS.LOG_LEVEL}=debug`,
        `${ENV_VARS.INPUT}={"urlCount":1,"retentionHours":1,"authKey":"${AUTH_KEY}"}`,
      ].join("\n"),
      ENCODINGS.UTF,
    );

    appProcess = await spawnAppProcess({
      port,
      cwd: tempCwd,
      injectPortEnv: false,
      injectInputEnv: false,
    });

    const unauthorized = await httpRequest(
      `${appProcess.baseUrl}${APP_ROUTES.INFO}`,
    );
    const authorized = await httpRequest(
      `${appProcess.baseUrl}${APP_ROUTES.INFO}`,
      "GET",
      {
        [HTTP_HEADERS.AUTHORIZATION]: `${AUTH_CONSTS.BEARER_PREFIX}${AUTH_KEY}`,
      },
    );

    expect(unauthorized.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(authorized.statusCode).toBe(HTTP_STATUS.OK);

    const infoBody = JSON.parse(authorized.bodyText);
    expect(Array.isArray(infoBody?.system?.activeWebhooks)).toBe(true);
    expect(infoBody.system.activeWebhooks).toHaveLength(1);
  });
});
