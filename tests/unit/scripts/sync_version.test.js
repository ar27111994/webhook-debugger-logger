/**
 * @file tests/unit/scripts/sync_version.test.js
 * @description Unit tests for the sync-version script logic using shared mocks.
 */

import { jest } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import {
  loggerMock,
  fsMock,
  systemMock,
} from "../../setup/helpers/shared-mocks.js";
import { assertType } from "../../setup/helpers/test-utils.js";
import { APP_ROUTES } from "../../../src/consts/app.js";
import { HTTP_STATUS, MIME_TYPES } from "../../../src/consts/http.js";

/**
 * @typedef {import('node:fs').PathOrFileDescriptor} PathOrFileDescriptor
 */

// Setup common mocks
await setupCommonMocks({
  logger: true,
  fs: true,
  system: true,
});

await jest.resetModules();
const { syncVersion } = await import("../../../scripts/sync-version.js");

describe("Sync Version Script", () => {
  // Constants for test data
  const PACKAGE_VERSION = "1.2.3";
  const OUTDATED_VERSION = "0.0.0";
  const WEBHOOK_API_TITLE = "Webhook API";
  const PACKAGE_JSON = JSON.stringify({ version: PACKAGE_VERSION });
  const ACTOR_JSON_OLD = JSON.stringify({
    version: OUTDATED_VERSION,
    name: "actor",
  });
  const ACTOR_JSON_MATCH = JSON.stringify({
    version: PACKAGE_VERSION,
    name: "actor",
  });
  const WEB_SERVER_SCHEMA_OLD = JSON.stringify({
    openapi: "3.0.3",
    info: { title: WEBHOOK_API_TITLE, version: OUTDATED_VERSION },
    paths: {
      [APP_ROUTES.DASHBOARD]: {
        get: {
          responses: {
            [HTTP_STATUS.OK.toString()]: {
              content: {
                [MIME_TYPES.TEXT]: {
                  example: `Webhook Debugger & Logger (v${OUTDATED_VERSION})\nActive Webhooks: 1\nSignature Verification: STRIPE`,
                },
              },
            },
          },
        },
      },
    },
  });
  const WEB_SERVER_SCHEMA_MATCH = JSON.stringify({
    openapi: "3.0.3",
    info: { title: WEBHOOK_API_TITLE, version: PACKAGE_VERSION },
    paths: {
      [APP_ROUTES.DASHBOARD]: {
        get: {
          responses: {
            [HTTP_STATUS.OK]: {
              content: {
                [MIME_TYPES.TEXT]: {
                  example: `Webhook Debugger & Logger (v${PACKAGE_VERSION})\nActive Webhooks: 1\nSignature Verification: STRIPE`,
                },
              },
            },
          },
        },
      },
    },
  });
  const WEB_SERVER_SCHEMA_EXAMPLE_OLD = JSON.stringify({
    openapi: "3.0.3",
    info: { title: WEBHOOK_API_TITLE, version: PACKAGE_VERSION },
    paths: {
      [APP_ROUTES.DASHBOARD]: {
        get: {
          responses: {
            [HTTP_STATUS.OK]: {
              content: {
                [MIME_TYPES.TEXT]: {
                  example: `Webhook Debugger & Logger (v${OUTDATED_VERSION})\nActive Webhooks: 1\nSignature Verification: STRIPE`,
                },
              },
            },
          },
        },
      },
    },
  });
  const WEB_SERVER_SCHEMA_WITHOUT_EXAMPLE = JSON.stringify({
    openapi: "3.0.3",
    info: { title: WEBHOOK_API_TITLE, version: PACKAGE_VERSION },
    paths: {
      [APP_ROUTES.DASHBOARD]: {
        get: {
          responses: {
            [HTTP_STATUS.OK]: {
              content: {
                [MIME_TYPES.TEXT]: {},
              },
            },
          },
        },
      },
    },
  });
  const ACTOR_JSON = "actor.json";
  const WEB_SERVER_SCHEMA_JSON = "web_server_schema.json";
  const PACKAGE_JSON_PATH = "package.json";
  const READ_FILE_COUNT = 3;
  const WRITE_FILE_COUNT = 2;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset shared mock implementations
    fsMock.readFileSync.mockReset();
    fsMock.writeFileSync.mockReset();
    systemMock.exit.mockReset();
  });

  it("should update actor.json and web_server_schema.json when versions mismatch", () => {
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} path
         * @returns {string}
         */
        (path) => {
          if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
          if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_OLD;
          if (String(path).includes(WEB_SERVER_SCHEMA_JSON)) {
            return WEB_SERVER_SCHEMA_OLD;
          }
          return "{}";
        },
      ),
    );

    syncVersion();

    expect(fsMock.readFileSync).toHaveBeenCalledTimes(READ_FILE_COUNT);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(WRITE_FILE_COUNT);

    const actorWrite = fsMock.writeFileSync.mock.calls.find(([path]) =>
      String(path).includes(ACTOR_JSON),
    );
    const schemaWrite = fsMock.writeFileSync.mock.calls.find(([path]) =>
      String(path).includes(WEB_SERVER_SCHEMA_JSON),
    );

    expect(actorWrite).toBeDefined();
    expect(schemaWrite).toBeDefined();

    const [, actorContent] = assertType(actorWrite);
    const [, schemaContent] = assertType(schemaWrite);

    const writtenActor = JSON.parse(assertType(actorContent));
    expect(writtenActor.version).toBe(PACKAGE_VERSION);

    const writtenSchema = JSON.parse(assertType(schemaContent));
    expect(writtenSchema.info.version).toBe(PACKAGE_VERSION);
    expect(
      writtenSchema.paths[APP_ROUTES.DASHBOARD].get.responses[
        HTTP_STATUS.OK.toString()
      ].content[MIME_TYPES.TEXT].example,
    ).toContain(`(v${PACKAGE_VERSION})`);

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining(PACKAGE_VERSION),
    );
  });

  it("should not write if versions match", () => {
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} path
         * @returns {string}
         */
        (path) => {
          if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
          if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_MATCH;
          if (String(path).includes(WEB_SERVER_SCHEMA_JSON)) {
            return WEB_SERVER_SCHEMA_MATCH;
          }
          return "{}";
        },
      ),
    );

    syncVersion();

    expect(fsMock.readFileSync).toHaveBeenCalledTimes(READ_FILE_COUNT);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("already in sync"),
    );
  });

  it("should update only web_server_schema.json when actor.json is already synced", () => {
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} path
         * @returns {string}
         */
        (path) => {
          if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
          if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_MATCH;
          if (String(path).includes(WEB_SERVER_SCHEMA_JSON)) {
            return WEB_SERVER_SCHEMA_OLD;
          }
          return "{}";
        },
      ),
    );

    syncVersion();

    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);

    const [path, content] = fsMock.writeFileSync.mock.calls[0];
    expect(path).toContain(WEB_SERVER_SCHEMA_JSON);

    const writtenSchema = JSON.parse(assertType(content));
    expect(writtenSchema.info.version).toBe(PACKAGE_VERSION);
  });

  it("should update only the web server schema example when the info version already matches", () => {
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} path
         * @returns {string}
         */
        (path) => {
          if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
          if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_MATCH;
          if (String(path).includes(WEB_SERVER_SCHEMA_JSON)) {
            return WEB_SERVER_SCHEMA_EXAMPLE_OLD;
          }
          return "{}";
        },
      ),
    );

    syncVersion();

    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);

    const [path, content] = fsMock.writeFileSync.mock.calls[0];
    expect(path).toContain(WEB_SERVER_SCHEMA_JSON);

    const writtenSchema = JSON.parse(assertType(content));
    expect(writtenSchema.info.version).toBe(PACKAGE_VERSION);
    expect(
      writtenSchema.paths[APP_ROUTES.DASHBOARD].get.responses[
        HTTP_STATUS.OK.toString()
      ].content[MIME_TYPES.TEXT].example,
    ).toContain(`(v${PACKAGE_VERSION})`);
  });

  it("should skip schema writes when the dashboard example is missing and versions already match", () => {
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} path
         * @returns {string}
         */
        (path) => {
          if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
          if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_MATCH;
          if (String(path).includes(WEB_SERVER_SCHEMA_JSON)) {
            return WEB_SERVER_SCHEMA_WITHOUT_EXAMPLE;
          }
          return "{}";
        },
      ),
    );

    syncVersion();

    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("already in sync"),
    );
  });

  it("should handle errors gracefully", () => {
    const error = "Read failed";
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error(error);
    });

    syncVersion();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: error }),
      }),
      expect.stringContaining(error),
    );
    expect(systemMock.exit).toHaveBeenCalledWith(1);
  });

  it("should handle invalid JSON gracefully", () => {
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} path
         * @returns {string}
         */
        (path) => {
          if (String(path).includes(PACKAGE_JSON_PATH))
            return "{ invalid json }";
          return "{}";
        },
      ),
    );

    syncVersion();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      expect.stringMatching(/Unexpected|JSON/),
    );
    expect(systemMock.exit).toHaveBeenCalledWith(1);
  });

  it("should throw error if package.json version is missing", () => {
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} _path
         * @returns {string}
         */
        (_path) => {
          return "{}"; // No version
        },
      ),
    );

    syncVersion();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      expect.stringContaining("version"),
    );
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      expect.stringContaining("version"),
    );
    expect(systemMock.exit).toHaveBeenCalledWith(1);
  });

  it("should execute if run as main script", async () => {
    // Mock valid files to avoid error exit
    fsMock.readFileSync.mockImplementation(
      assertType(
        /**
         * @param {PathOrFileDescriptor} path
         * @returns {string}
         */
        (path) => {
          if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
          if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_MATCH;
          if (String(path).includes(WEB_SERVER_SCHEMA_JSON)) {
            return WEB_SERVER_SCHEMA_MATCH;
          }
          return "{}";
        },
      ),
    );
    fsMock.writeFileSync.mockImplementation(() => {});

    // Calculate expected path
    const { fileURLToPath } = await import("url");
    const scriptPath = fileURLToPath(
      new URL("../../../scripts/sync-version.js", import.meta.url),
    );

    const originalArgv = process.argv;
    process.argv = [...originalArgv]; // Clone
    process.argv[1] = scriptPath;

    jest.resetModules();
    await import("../../../scripts/sync-version.js");

    // Should have called readFileSync (implies syncVersion() ran)
    expect(fsMock.readFileSync).toHaveBeenCalled();

    process.argv = originalArgv;
  });
});
