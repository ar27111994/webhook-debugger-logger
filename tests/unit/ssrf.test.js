/**
 * @file tests/unit/ssrf.test.js
 * @description Unit tests for SSRF protection utilities.
 */

import { jest } from '@jest/globals';
import { SSRF_ERRORS } from '../../src/consts/security.js';
import { assertType } from '../setup/helpers/test-utils.js';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { dnsPromisesMock, loggerMock } from '../setup/helpers/shared-mocks.js';
import { APP_CONSTS } from '../../src/consts/app.js';

await setupCommonMocks({ logger: true, dns: true });

// Import subject AFTER mocking and resetting modules
const { useFakeTimers } = await import('../setup/helpers/test-lifecycle.js');
const { checkIpInRanges, validateUrlForSsrf } = await import('../../src/utils/ssrf.js');

describe('SSRF Utilities', () => {
    const VALID_URL = 'https://google.com/foo';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('checkIpInRanges', () => {
        // eslint-disable-next-line sonarjs/no-hardcoded-ip
        const ranges = ['192.168.0.0/16', '10.0.0.1', '::1'];

        it('should return true for IPs in CIDR range', () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(checkIpInRanges('192.168.1.50', ranges)).toBe(true);
        });

        it('should return true for exact IP match', () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(checkIpInRanges('10.0.0.1', ranges)).toBe(true);
        });

        it('should return false for IPs outside ranges', () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(checkIpInRanges('8.8.8.8', ranges)).toBe(false);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(checkIpInRanges('10.0.0.2', ranges)).toBe(false);
        });

        it('should handle IPv4-mapped IPv6 addresses', () => {
            // ::ffff:192.168.1.50 is technically 192.168.1.50
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(checkIpInRanges('::ffff:192.168.1.50', ranges)).toBe(true);
        });

        it('should handle invalid IPs gracefully', () => {
            expect(checkIpInRanges('invalid-ip', ranges)).toBe(false);
            expect(checkIpInRanges(assertType(null), ranges)).toBe(false);
        });

        it('should ignore invalid range entries in configuration', () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            const rangesWithInvalid = ['invalid-range', '192.168.0.0/16'];
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(checkIpInRanges('192.168.1.50', rangesWithInvalid)).toBe(true);
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(checkIpInRanges('8.8.8.8', rangesWithInvalid)).toBe(false);
        });
    });

    describe('validateUrlForSsrf', () => {
        useFakeTimers();

        it('should return valid result for safe URL', async () => {
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['8.8.8.8']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            const result = await validateUrlForSsrf(VALID_URL);
            expect(result.safe).toBe(true);
            expect(result.href).toBe(new URL(VALID_URL).href);
        });

        it('should reject invalid URLs', async () => {
            const result = await validateUrlForSsrf('not-a-url');
            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.INVALID_URL);
        });

        it('should reject forbidden protocols', async () => {
            const result = await validateUrlForSsrf('ftp://example.com/file');
            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.PROTOCOL_NOT_ALLOWED);
        });

        it('should reject credentials in URL', async () => {
            const result = await validateUrlForSsrf('https://user:pass@example.com');
            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.CREDENTIALS_NOT_ALLOWED);
        });

        it('should reject URLs resolving to blocked IPs', async () => {
            // Mock DNS to return blocked IP
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['169.254.169.254']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            const result = await validateUrlForSsrf('http://metadata.cloud');
            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.INTERNAL_IP);
        });

        it('should check both IPv4 and IPv6 results', async () => {
            // IPv4 safe, IPv6 unsafe
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['93.184.216.34']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType(['::1'])); // Localhost IPv6 blocked

            const result = await validateUrlForSsrf('http://example.com');
            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.INTERNAL_IP);
        });

        it('should handle DNS resolution failure', async () => {
            (dnsPromisesMock.resolve4).mockRejectedValue(assertType(new Error('ENOTFOUND')));
            (dnsPromisesMock.resolve6).mockRejectedValue(assertType(new Error('ENOTFOUND')));

            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            const result = await validateUrlForSsrf('http://nonexistent.domain');
            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED);
        });

        it('should reject if DNS resolution returns no IPs', async () => {
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType([]));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            const result = await validateUrlForSsrf('http://empty.domain');
            expect(result.safe).toBe(false);
            // It might return HOSTNAME_RESOLUTION_FAILED if list empty
            expect(result.error).toBe(SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED);
        });

        it('should handle direct IP literals correctly (Line 124)', async () => {
            const result = await validateUrlForSsrf('http://127.0.0.1'); // Localhost, blocked
            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.INTERNAL_IP);
        });

        it('should handle DNS timeout (Lines 136, 164, 195-205)', async () => {
            // Mock DNS response to hang, triggering timeout promise
            (dnsPromisesMock.resolve4).mockImplementation(assertType(() => new Promise(() => { })));
            (dnsPromisesMock.resolve6).mockImplementation(assertType(() => new Promise(() => { })));

            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            const validationPromise = validateUrlForSsrf('http://timeout.com');

            // Advance time to trigger buffer timeout
            const seconds = 5;
            const timeout = seconds * APP_CONSTS.MS_PER_SECOND;
            jest.advanceTimersByTime(timeout); // NETWORK_TIMEOUTS.DNS_RESOLUTION

            const result = await validationPromise;

            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.VALIDATION_FAILED);
            expect(loggerMock.error).toHaveBeenCalled();
        });

        it('should handle invalid resolved IPs (Line 182)', async () => {
            // Mock resolve to return invalid IP string
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['invalid-ip']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            const result = await validateUrlForSsrf('http://weird-dns.com');

            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.INVALID_IP);
        });

        it('should handle generic unexpected errors (Lines 195-205)', async () => {
            // Throw SYNCHRONOUSLY to bypass Promise.allSettled and hit the catch block directly
            (dnsPromisesMock.resolve4).mockImplementation(() => {
                throw new Error('Unexpected Crash');
            });

            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            const result = await validateUrlForSsrf('http://crash.com');

            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.VALIDATION_FAILED);
            expect(loggerMock.error).toHaveBeenCalled();
        });

        it('should handle non-Error exceptions', async () => {
            // Throw a string to cover the else branch of "e instanceof Error"
            (dnsPromisesMock.resolve4).mockImplementation(() => {
                throw 'Critical Failure';
            });

            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            const result = await validateUrlForSsrf('http://string-throw.com');

            expect(result.safe).toBe(false);
            expect(result.error).toBe(SSRF_ERRORS.VALIDATION_FAILED);
            expect(loggerMock.error).toHaveBeenCalled();
        });
    });

    describe('Advanced Security & Concurrency', () => {
        it('should handle concurrency safely', async () => {
            const iterations = 50;
            const urls = Array(iterations).fill(VALID_URL);

            // Mock successful resolution
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['8.8.8.8']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            const results = await Promise.all(urls.map(url => validateUrlForSsrf(url)));

            expect(results).toHaveLength(iterations);
            results.forEach(result => {
                expect(result.safe).toBe(true);
            });
        });

        it('should handle IDN domains (Punycode)', async () => {
            const idnUrl = 'https://xn--unicode-domain.com'; // “unicode-domain.com”

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['8.8.8.8']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            const result = await validateUrlForSsrf(idnUrl);
            expect(result.safe).toBe(true);
        });

        it('should handle mixed case protocols', async () => {
            const mixedUrl = 'HttPs://google.com';

            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['8.8.8.8']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            const result = await validateUrlForSsrf(mixedUrl);
            expect(result.safe).toBe(true);
        });

        it('should detect blocked IPs even if obfuscated (Octal/Hex)', async () => {
            // Octal: 0177.0.0.1 (127.0.0.1), Hex: 0x7f000001 (127.0.0.1)
            // If the browser/URL parser normalizes these, good. 
            // If not, they go to DNS. If DNS resolves them to 127.0.0.1, we MUST block them.

            (dnsPromisesMock.resolve4).mockResolvedValue(assertType(['127.0.0.1']));
            (dnsPromisesMock.resolve6).mockResolvedValue(assertType([]));

            // Test Octal
            const resultOctal = await validateUrlForSsrf('http://0177.0.0.1');
            expect(resultOctal.safe).toBe(false);
            expect(resultOctal.error).toBe(SSRF_ERRORS.INTERNAL_IP);

            // Test Hex
            const resultHex = await validateUrlForSsrf('http://0x7f000001');
            expect(resultHex.safe).toBe(false);
            expect(resultHex.error).toBe(SSRF_ERRORS.INTERNAL_IP);
        });
    });
});
