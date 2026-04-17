/**
 * @file scripts/sync-version.js
 * @description Syncs the version from package.json to generated actor metadata files.
 * @module scripts/sync-version
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { APP_CONSTS, APP_ROUTES, EXIT_CODES } from "../src/consts/app.js";
import { FILE_NAMES } from "../src/consts/storage.js";
import { ENCODINGS, HTTP_STATUS, MIME_TYPES } from "../src/consts/http.js";
import { LOG_COMPONENTS } from "../src/consts/logging.js";
import { LOG_MESSAGES } from "../src/consts/messages.js";
import { ERROR_MESSAGES } from "../src/consts/errors.js";
import { createChildLogger, serializeError } from "../src/utils/logger.js";
import { exit } from "../src/utils/system.js";

const log = createChildLogger({ component: LOG_COMPONENTS.SYNC_VERSION });

const actorJsonPath = fileURLToPath(
  new URL(FILE_NAMES.ACTOR_JSON, import.meta.url),
);
const webServerSchemaPath = fileURLToPath(
  new URL(FILE_NAMES.WEB_SERVER_SCHEMA_JSON, import.meta.url),
);
const packageJsonPath = fileURLToPath(
  new URL(FILE_NAMES.PACKAGE_JSON, import.meta.url),
);
const DASHBOARD_EXAMPLE_VERSION_PATTERN =
  /(Webhook Debugger & Logger \(v)([^)]+)(\))/;

/**
 * @param {string} path
 * @param {unknown} data
 * @returns {void}
 */
const writeJsonFile = (path, data) => {
  writeFileSync(
    path,
    JSON.stringify(data, null, APP_CONSTS.JSON_INDENT) + "\n",
  );
};

/**
 * @param {Record<string, any>} webServerSchema
 * @param {string} packageVersion
 * @returns {boolean}
 */
const syncDashboardExampleVersion = (webServerSchema, packageVersion) => {
  const dashboardExample =
    webServerSchema.paths?.[APP_ROUTES.DASHBOARD]?.get?.responses?.[
      HTTP_STATUS.OK.toString()
    ]?.content?.[MIME_TYPES.TEXT]?.example;

  if (typeof dashboardExample !== "string") {
    return false;
  }

  const updatedExample = dashboardExample.replace(
    DASHBOARD_EXAMPLE_VERSION_PATTERN,
    `$1${packageVersion}$3`,
  );

  if (updatedExample === dashboardExample) {
    return false;
  }

  webServerSchema.paths[APP_ROUTES.DASHBOARD].get.responses[
    HTTP_STATUS.OK.toString()
  ].content[MIME_TYPES.TEXT].example = updatedExample;
  return true;
};

export const syncVersion = () => {
  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, ENCODINGS.UTF8),
    );
    const packageVersion = packageJson.version;

    if (!packageVersion) {
      throw new Error(ERROR_MESSAGES.SYNC_VERSION_MISSING_PACKAGE_VERSION);
    }

    const actorJson = JSON.parse(readFileSync(actorJsonPath, ENCODINGS.UTF8));
    const webServerSchema = JSON.parse(
      readFileSync(webServerSchemaPath, ENCODINGS.UTF8),
    );
    let didSync = false;

    if (actorJson.version !== packageVersion) {
      actorJson.version = packageVersion;
      writeJsonFile(actorJsonPath, actorJson);
      didSync = true;
    }

    let didSyncSchema = false;

    if (webServerSchema.info?.version !== packageVersion) {
      webServerSchema.info = {
        ...webServerSchema.info,
        version: packageVersion,
      };
      didSyncSchema = true;
    }

    if (syncDashboardExampleVersion(webServerSchema, packageVersion)) {
      didSyncSchema = true;
    }

    if (didSyncSchema) {
      writeJsonFile(webServerSchemaPath, webServerSchema);
      didSync = true;
    }

    if (didSync) {
      log.info(LOG_MESSAGES.SYNC_VERSION_SUCCESS(packageVersion));
    } else {
      log.info(LOG_MESSAGES.SYNC_VERSION_ALREADY_SYNCED);
    }
  } catch (error) {
    log.error(
      { err: serializeError(error) },
      ERROR_MESSAGES.SYNC_VERSION_FAILED(/** @type {Error} */ (error).message),
    );
    exit(EXIT_CODES.FAILURE);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncVersion();
}
