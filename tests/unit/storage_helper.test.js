/**
 * @file tests/unit/storage_helper.test.js
 * @description Unit tests for storage utilities.
 */

import { jest } from '@jest/globals';
import { STORAGE_CONSTS } from '../../src/consts/storage.js';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { apifyMock } from '../setup/helpers/shared-mocks.js';
import { assertType } from '../setup/helpers/test-utils.js';
import { MIME_TYPES } from '../../src/consts/http.js';

// Mock dependencies
const mockNanoid = jest.fn(() => 'mock-id');
jest.unstable_mockModule('nanoid', () => ({ nanoid: mockNanoid }));

// Setup shared mocks (includes apify)
await setupCommonMocks({ apify: true });

// Import module under test
const {
    generateKvsKey,
    offloadToKvs,
    getKvsUrl,
    createReferenceBody
} = await import('../../src/utils/storage_helper.js');

describe('Storage Helper Utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset defaults
        mockNanoid.mockReturnValue('mock-id');
        apifyMock.openKeyValueStore.mockResolvedValue({
            setValue: jest.fn(),
            getPublicUrl: assertType(jest.fn(() => 'https://api.apify.com/v2/key-value-stores/default/records/mock-key')),
            getValue: jest.fn()
        });
    });

    describe('generateKvsKey', () => {
        it('should generate a key with the correct prefix and id', () => {
            const key = generateKvsKey();
            expect(key).toBe(`${STORAGE_CONSTS.KVS_KEY_PREFIX}mock-id`);
            expect(mockNanoid).toHaveBeenCalled();
        });
    });

    describe('offloadToKvs', () => {
        it('should offload content to the key value store', async () => {
            const key = 'test-key';
            const value = 'some-content';
            const contentType = MIME_TYPES.TEXT;

            const mockSetValue = jest.fn();
            apifyMock.openKeyValueStore.mockResolvedValueOnce(assertType({
                setValue: mockSetValue
            }));

            await offloadToKvs(key, value, contentType);

            expect(apifyMock.openKeyValueStore).toHaveBeenCalled();
            expect(mockSetValue).toHaveBeenCalledWith(key, value, { contentType });
        });
    });

    describe('getKvsUrl', () => {
        it('should return public URL from KV store', async () => {
            const key = 'test-key';
            const url = await getKvsUrl(key);
            expect(url).toBe('https://api.apify.com/v2/key-value-stores/default/records/mock-key');
        });

        it('should fallback if openKeyValueStore fails', async () => {
            apifyMock.openKeyValueStore.mockRejectedValueOnce(new Error('KVS Error'));
            const key = 'test-key';

            const url = await getKvsUrl(key);

            expect(url).toBe(STORAGE_CONSTS.KVS_URL_FALLBACK.replaceAll('${key}', key));
        });

        it('should fallback if getPublicUrl is not a function', async () => {
            apifyMock.openKeyValueStore.mockResolvedValueOnce(assertType({})); // No getPublicUrl method
            const key = 'test-key';

            const url = await getKvsUrl(key);

            expect(url).toBe(STORAGE_CONSTS.KVS_URL_FALLBACK.replaceAll('${key}', key));
        });
    });

    describe('createReferenceBody', () => {
        it('should create a correctly formatted reference object', () => {
            const key = 'test-key';
            const kvsUrl = 'http://example.com/item';
            const originalSize = 1024;
            const opts = {
                key,
                kvsUrl,
                originalSize
            };

            const result = createReferenceBody(opts);

            expect(result).toEqual({
                data: STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
                key,
                note: STORAGE_CONSTS.DEFAULT_OFFLOAD_NOTE,
                originalSize,
                kvsUrl
            });
        });

        it('should allow overriding defaults', () => {
            const key = 'test-key';
            const kvsUrl = 'http://example.com/item';
            const originalSize = 500;
            const note = 'Custom Note';
            const data = 'CUSTOM_MARKER';
            const opts = {
                key,
                kvsUrl,
                originalSize,
                note,
                data
            };

            const result = createReferenceBody(opts);

            expect(result).toEqual({
                data,
                key,
                note,
                originalSize,
                kvsUrl
            });
        });
    });
});
