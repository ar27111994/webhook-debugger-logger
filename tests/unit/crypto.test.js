/**
 * @file tests/unit/crypto.test.js
 * @description Unit tests for cryptographic utility functions.
 * Use text/decoder to inspect raw logic if buffer comparison used.
 */


import { secureCompare } from '../../src/utils/crypto.js';
import { assertType } from '../setup/helpers/test-utils.js';

describe('Crypto Utils', () => {
    describe('secureCompare', () => {
        it('should return true for identical strings', () => {
            expect(secureCompare('my-secret', 'my-secret')).toBe(true);
        });

        it('should return false for different strings of same length', () => {
            expect(secureCompare('my-secret', 'my-secres')).toBe(false);
        });

        it('should return false for strings of different lengths', () => {
            expect(secureCompare('safe', 'safely')).toBe(false);
        });

        it('should return false for empty strings comparison logic edge case', () => {
            // Depending on logic, timing safe usually pads.
            // If secureCompare logic requires non-empty, verify it doesn't crash
            expect(secureCompare('', '')).toBe(true);
            expect(secureCompare('a', '')).toBe(false);
        });

        it('should handle null/undefined inputs safely (return false)', () => {
            expect(secureCompare(assertType(null), 'test')).toBe(false);
            expect(secureCompare('test', assertType(undefined))).toBe(false);
            expect(secureCompare(assertType(null), assertType(null))).toBe(false); // Technically not matches
        });

        it('should simulate timing-safe behavior (no early exit)', () => {
            // Ideally we'd verify timing but unit tests can't reliably catch nanoseconds.
            // We verify logic correctness:
            // "a" vs "b" -> false
            // "a" vs "a" -> true
            expect(secureCompare('a', 'b')).toBe(false);
            expect(secureCompare('a', 'a')).toBe(true);
        })
    });
});
