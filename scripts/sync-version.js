/**
 * @file scripts/sync-version.js
 * @description Syncs the version from package.json to actor.json.
 * @module scripts/sync-version
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { APP_CONSTS, EXIT_CODES } from '../src/consts/app.js';
import { FILE_NAMES } from '../src/consts/storage.js';
import { ENCODINGS } from '../src/consts/http.js';
import { LOG_COMPONENTS } from '../src/consts/logging.js';
import { LOG_MESSAGES } from '../src/consts/messages.js';
import { ERROR_MESSAGES } from '../src/consts/errors.js';
import { createChildLogger, serializeError } from '../src/utils/logger.js';
import { exit } from '../src/utils/system.js';

const log = createChildLogger({ component: LOG_COMPONENTS.SYNC_VERSION });

const actorJsonPath = fileURLToPath(new URL(FILE_NAMES.ACTOR_JSON, import.meta.url));
const packageJsonPath = fileURLToPath(new URL(FILE_NAMES.PACKAGE_JSON, import.meta.url));

export const syncVersion = () => {
    try {
        const actorJson = JSON.parse(readFileSync(actorJsonPath, ENCODINGS.UTF8));
        const packageJson = JSON.parse(readFileSync(packageJsonPath, ENCODINGS.UTF8));
        const packageVersion = packageJson.version;

        if (!packageVersion) {
            throw new Error(ERROR_MESSAGES.SYNC_VERSION_MISSING_PACKAGE_VERSION);
        }

        if (actorJson.version !== packageVersion) {
            actorJson.version = packageVersion;
            writeFileSync(actorJsonPath, JSON.stringify(actorJson, null, APP_CONSTS.JSON_INDENT) + '\n');
            log.info(LOG_MESSAGES.SYNC_VERSION_SUCCESS(packageVersion));
        } else {
            log.info(LOG_MESSAGES.SYNC_VERSION_ALREADY_SYNCED);
        }
    } catch (error) {
        log.error({ err: serializeError(error) }, ERROR_MESSAGES.SYNC_VERSION_FAILED(/** @type {Error} */(error).message));
        exit(EXIT_CODES.FAILURE);
    }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    syncVersion();
}
