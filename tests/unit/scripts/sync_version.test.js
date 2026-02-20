/**
 * @file tests/unit/scripts/sync_version.test.js
 * @description Unit tests for the sync-version script logic using shared mocks.
 */

import { jest } from '@jest/globals';
import { setupCommonMocks } from '../../setup/helpers/mock-setup.js';
import { loggerMock, fsMock, systemMock } from '../../setup/helpers/shared-mocks.js';
import { assertType } from '../../setup/helpers/test-utils.js';

/**
 * @typedef {import('node:fs').PathOrFileDescriptor} PathOrFileDescriptor
 */

// Setup common mocks
await setupCommonMocks({
    logger: true,
    fs: true,
    system: true
});

await jest.resetModules();
const { syncVersion } = await import('../../../scripts/sync-version.js');

describe('Sync Version Script', () => {
    // Constants for test data
    const PACKAGE_VERSION = '1.2.3';
    const PACKAGE_JSON = JSON.stringify({ version: PACKAGE_VERSION });
    const ACTOR_JSON_OLD = JSON.stringify({ version: '0.0.0', name: 'actor' });
    const ACTOR_JSON_MATCH = JSON.stringify({ version: PACKAGE_VERSION, name: 'actor' });
    const ACTOR_JSON = 'actor.json';
    const PACKAGE_JSON_PATH = 'package.json';

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset shared mock implementations
        fsMock.readFileSync.mockReset();
        fsMock.writeFileSync.mockReset();
        systemMock.exit.mockReset();
    });

    it('should update actor.json when versions mismatch', () => {
        fsMock.readFileSync.mockImplementation(assertType(
            /** 
             * @param {PathOrFileDescriptor} path
             * @returns {string}
             */
            (path) => {
                if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
                if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_OLD;
                return '{}';
            }));

        syncVersion();

        expect(fsMock.readFileSync).toHaveBeenCalledTimes(1 + 1);
        expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);

        const [path, content] = fsMock.writeFileSync.mock.calls[0];
        expect(path).toContain(ACTOR_JSON);

        const written = JSON.parse(assertType(content));
        expect(written.version).toBe(PACKAGE_VERSION);

        expect(loggerMock.info).toHaveBeenCalledWith(expect.stringContaining(PACKAGE_VERSION));
    });

    it('should not write if versions match', () => {
        fsMock.readFileSync.mockImplementation(assertType(
            /** 
             * @param {PathOrFileDescriptor} path
             * @returns {string}
             */
            (path) => {
                if (String(path).includes(PACKAGE_JSON_PATH)) return PACKAGE_JSON;
                if (String(path).includes(ACTOR_JSON)) return ACTOR_JSON_MATCH;
                return '{}';
            }));

        syncVersion();

        expect(fsMock.readFileSync).toHaveBeenCalledTimes(1 + 1);
        expect(fsMock.writeFileSync).not.toHaveBeenCalled();
        expect(loggerMock.info).toHaveBeenCalledWith(expect.stringContaining('already in sync'));
    });

    it('should handle errors gracefully', () => {
        const error = 'Read failed';
        fsMock.readFileSync.mockImplementation(() => {
            throw new Error(error);
        });

        syncVersion();

        expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.objectContaining({ message: error }) }),
            expect.stringContaining(error)
        );
        expect(systemMock.exit).toHaveBeenCalledWith(1);
    });

    it('should handle invalid JSON gracefully', () => {
        fsMock.readFileSync.mockImplementation(assertType(
            /** 
             * @param {PathOrFileDescriptor} path
             * @returns {string}
             */
            (path) => {
                if (String(path).includes(PACKAGE_JSON_PATH)) return '{ invalid json }';
                return '{}';
            }));

        syncVersion();

        expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.anything() }),
            expect.stringMatching(/Unexpected|JSON/)
        );
        expect(systemMock.exit).toHaveBeenCalledWith(1);
    });

    it('should throw error if package.json version is missing', () => {
        fsMock.readFileSync.mockImplementation(assertType(
            /** 
             * @param {PathOrFileDescriptor} _path
             * @returns {string}
             */
            (_path) => {
                return '{}'; // No version
            }));

        syncVersion();

        expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.anything() }),
            expect.stringContaining('version')
        );
        expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.anything() }),
            expect.stringContaining('version')
        );
        expect(systemMock.exit).toHaveBeenCalledWith(1);
    });

    it('should execute if run as main script', async () => {
        // Mock valid files to avoid error exit
        fsMock.readFileSync.mockReturnValue('{}');
        fsMock.writeFileSync.mockImplementation(() => { });

        // Calculate expected path
        const { fileURLToPath } = await import('url');
        const scriptPath = fileURLToPath(new URL('../../../scripts/sync-version.js', import.meta.url));

        const originalArgv = process.argv;
        process.argv = [...originalArgv]; // Clone
        process.argv[1] = scriptPath;

        jest.resetModules();
        await import('../../../scripts/sync-version.js');

        // Should have called readFileSync (implies syncVersion() ran)
        expect(fsMock.readFileSync).toHaveBeenCalled();

        process.argv = originalArgv;
    });
});
