/**
 * @file tests/unit/consts.test.js
 * @description Unit tests for logic within the consts directory.
 * Mostly testing arrow functions that generate dynamic messages and helper util logic like convertToEnum.
 */


import { LOG_MESSAGES } from '../../src/consts/messages.js';
import { ERROR_MESSAGES, SIGNATURE_ERRORS } from '../../src/consts/errors.js';
import {
    SIGNATURE_PROVIDERS,
    HASH_ALGORITHMS,
    SIGNATURE_ENCODINGS,
    SECURITY_CONSTS,
} from '../../src/consts/security.js';
import { APP_CONSTS, ENV_VARS } from '../../src/consts/app.js';
import { SSRF_BLOCKED_RANGES } from '../../src/consts/network.js';
import { LOG_CONSTS } from '../../src/consts/logging.js';
import { DUCKDB_SCHEMA, SQL_CONSTS } from '../../src/consts/database.js';
import { UNAUTHORIZED_HTML_TEMPLATE } from '../../src/consts/ui.js';
import { jest } from '@jest/globals';

const MOCK_PORT = 3000;
const MOCK_SSE_LIMIT = 10;
const MOCK_TIMEOUT = 5000;
const HTTP_OK = 200;
const HTTP_ERROR = 500;
const REQ_LIMIT = 100;
const REQ_WINDOW = 60;
const PAYLOAD_LIMIT_BYTES = 1024;
const RETRY_ATTEMPTS = 3;
const RETRY_TIMEOUT_MS = 30000;
const MAX_RETRIES = 5;
const NON_NEGATIVE_TEST_VAL = -1;
const COUNT_OVER_MAX = 150;
const MAX_COUNT = 100;
const NEGATIVE_RETENTION = -5;
const SSE_CONN_LIMIT = 50;
const ATTEMPT_count = 2;
const MIN_WEBHOOK_LIMIT = 60;

describe('Consts Logic', () => {
    describe('LOG_MESSAGES', () => {
        it('should format SERVER_STARTED correctly', () => {
            expect(LOG_MESSAGES.SERVER_STARTED(MOCK_PORT)).toBe(
                `Web server listening on port ${MOCK_PORT}`
            );
        });

        it('should format SHUTDOWN_INITIATED correctly', () => {
            const signal = 'SIGTERM';
            expect(LOG_MESSAGES.SHUTDOWN_INITIATED(signal)).toBe(
                'Shutting down server (SIGTERM)...'
            );
        });

        it('should format SSE_CONNECTION_LIMIT_REACHED correctly', () => {
            expect(LOG_MESSAGES.SSE_CONNECTION_LIMIT_REACHED(MOCK_SSE_LIMIT)).toBe(
                `Maximum SSE connections reached (${MOCK_SSE_LIMIT}). Try again later.`
            );
        });

        it('should format SCRIPT_EXECUTION_TIMED_OUT correctly', () => {
            expect(LOG_MESSAGES.SCRIPT_EXECUTION_TIMED_OUT(MOCK_TIMEOUT)).toBe(
                `Custom script execution timed out after ${MOCK_TIMEOUT}ms`
            );
        });

        it('should format WEBHOOK_RECEIVED_STATUS correctly', () => {
            expect(LOG_MESSAGES.WEBHOOK_RECEIVED_STATUS(HTTP_OK)).toBe(
                `Webhook received with status ${HTTP_OK}`
            );
        });

        it('should format SYNC_VERSION_SUCCESS correctly', () => {
            expect(LOG_MESSAGES.SYNC_VERSION_SUCCESS('1.2.3')).toBe(
                'Synced actor.json to v1.2.3'
            );
        });
    });

    describe('ERROR_MESSAGES', () => {
        it('should format FORWARD_REQUEST_FAILED_STATUS correctly', () => {
            expect(ERROR_MESSAGES.FORWARD_REQUEST_FAILED_STATUS(HTTP_ERROR)).toBe(
                `Request failed with status code ${HTTP_ERROR}`
            );
        });

        it('should format RATE_LIMIT_EXCEEDED correctly', () => {
            expect(ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(REQ_LIMIT, REQ_WINDOW)).toBe(
                `Rate limit exceeded. Max ${REQ_LIMIT} requests per ${REQ_WINDOW}s.`
            );
        });

        it('should format PAYLOAD_TOO_LARGE correctly', () => {
            expect(ERROR_MESSAGES.PAYLOAD_TOO_LARGE(PAYLOAD_LIMIT_BYTES)).toBe(
                `Payload too large. Limit is ${PAYLOAD_LIMIT_BYTES} bytes.`
            );
        });

        it('should format REPLAY_TIMEOUT correctly', () => {
            // 30000ms / 1000 = 30s
            expect(ERROR_MESSAGES.REPLAY_TIMEOUT(RETRY_ATTEMPTS, RETRY_TIMEOUT_MS)).toBe(
                `Target destination timed out after ${RETRY_ATTEMPTS} attempts (30s timeout per attempt)`
            );
        });

        it('should format REPLAY_ATTEMPTS_EXHAUSTED correctly', () => {
            expect(ERROR_MESSAGES.REPLAY_ATTEMPTS_EXHAUSTED(MAX_RETRIES)).toBe(
                `All ${MAX_RETRIES} retry attempts exhausted`
            );
        });

        it('should format INVALID_COUNT & INVALID_COUNT_MAX correctly', () => {
            expect(ERROR_MESSAGES.INVALID_COUNT(NON_NEGATIVE_TEST_VAL)).toBe(
                `Invalid count: ${NON_NEGATIVE_TEST_VAL}. Must be a non-negative integer.`
            );
            expect(ERROR_MESSAGES.INVALID_COUNT_MAX(COUNT_OVER_MAX, MAX_COUNT)).toBe(
                `Invalid count: ${COUNT_OVER_MAX}. Max allowed is ${MAX_COUNT}.`
            );
        });

        it('should format INVALID_RETENTION correctly', () => {
            expect(ERROR_MESSAGES.INVALID_RETENTION(NEGATIVE_RETENTION)).toBe(
                `Invalid retentionHours: ${NEGATIVE_RETENTION}. Must be a positive number.`
            );
        });

        it('should format SSE_LIMIT_REACHED correctly', () => {
            expect(ERROR_MESSAGES.SSE_LIMIT_REACHED(SSE_CONN_LIMIT)).toBe(
                `Maximum SSE connections reached (${SSE_CONN_LIMIT}). Try again later.`
            );
        });

        it('should format FORWARD_FAILURE_DETAILS correctly', () => {
            // Transient case
            expect(
                ERROR_MESSAGES.FORWARD_FAILURE_DETAILS(
                    'http://example.com',
                    true,
                    ATTEMPT_count,
                    'Timeout'
                )
            ).toBe(`Forwarding to http://example.com failed after ${ATTEMPT_count} attempts. Last error: Timeout`);

            // Non-transient case
            expect(
                ERROR_MESSAGES.FORWARD_FAILURE_DETAILS(
                    'http://example.com',
                    false,
                    1,
                    '400 Bad Request'
                )
            ).toBe(
                'Forwarding to http://example.com failed (Non-transient error) after 1 attempts. Last error: 400 Bad Request'
            );
        });

        it('should format WEBHOOK_RATE_LIMIT_EXCEEDED correctly', () => {
            expect(ERROR_MESSAGES.WEBHOOK_RATE_LIMIT_EXCEEDED(MIN_WEBHOOK_LIMIT)).toBe(
                `Webhook rate limit exceeded. Max ${MIN_WEBHOOK_LIMIT} requests per minute per webhook.`
            );
        });

        it('should format ACTOR_PUSH_DATA_TIMEOUT correctly', () => {
            expect(ERROR_MESSAGES.ACTOR_PUSH_DATA_TIMEOUT(MOCK_TIMEOUT)).toBe(
                `Actor.pushData timeout after ${MOCK_TIMEOUT}ms`
            );
        });

        it('should format ALERT_URL_BLOCKED_BY_SSRF_POLICY correctly', () => {
            expect(ERROR_MESSAGES.ALERT_URL_BLOCKED_BY_SSRF_POLICY('Private IP')).toBe(
                'Alert URL blocked by SSRF policy: Private IP'
            );
        });

        it('should format JSON_PARSE_ERROR correctly', () => {
            expect(ERROR_MESSAGES.JSON_PARSE_ERROR('Unexpected token')).toBe(
                'JSON parse error: Unexpected token'
            );
        });

        it('should format SYNC_VERSION_FAILED correctly', () => {
            expect(ERROR_MESSAGES.SYNC_VERSION_FAILED('ENOENT')).toBe(
                'Failed to sync version: ENOENT'
            );
        });
    });

    describe('SIGNATURE_ERRORS', () => {
        it('should format MISSING_CUSTOM_HEADER correctly', () => {
            expect(SIGNATURE_ERRORS.MISSING_CUSTOM_HEADER('x-signature')).toBe(
                'Missing x-signature header'
            );
        });
    });

    describe('Security Constants (convertToEnum Logic)', () => {
        // We can't directly test convertToEnum as it is not exported, 
        // but we can verify the resulting objects are correct, which implicitly tests the logic.

        it('should have SIGNATURE_PROVIDERS with upper-case keys and lower-case values', () => {
            // Assuming 'github' is in the input_schema enum
            // We check if the object has the expected structure
            expect(SIGNATURE_PROVIDERS).toHaveProperty('GITHUB', 'github');
            expect(SIGNATURE_PROVIDERS).toHaveProperty('STRIPE', 'stripe');
            expect(Object.isFrozen(SIGNATURE_PROVIDERS)).toBe(true);
        });

        it('should have HASH_ALGORITHMS correctly mapped', () => {
            expect(HASH_ALGORITHMS).toHaveProperty('SHA256', 'sha256');
            expect(Object.isFrozen(HASH_ALGORITHMS)).toBe(true);
        });

        it('should have SIGNATURE_ENCODINGS correctly mapped', () => {
            expect(SIGNATURE_ENCODINGS).toHaveProperty('HEX', 'hex');
            expect(Object.isFrozen(SIGNATURE_ENCODINGS)).toBe(true);
        });

        it('should have a secure CSP policy defined', () => {
            expect(SECURITY_CONSTS.CSP_POLICY).toContain("default-src 'self'");
            expect(SECURITY_CONSTS.CSP_POLICY).toContain("script-src 'self' 'unsafe-inline'");
            expect(Object.isFrozen(SECURITY_CONSTS)).toBe(true);
        });
    });

    describe('Paranoid Safety Checks', () => {
        it('should ensure critical configuration objects are immutable (frozen)', () => {
            expect(Object.isFrozen(APP_CONSTS)).toBe(true);
            expect(Object.isFrozen(SSRF_BLOCKED_RANGES)).toBe(true);
            expect(Object.isFrozen(LOG_CONSTS)).toBe(true);
            expect(Object.isFrozen(SQL_CONSTS)).toBe(true);
            expect(Object.isFrozen(DUCKDB_SCHEMA)).toBe(true);
        });

        it('should verify LOG_CONSTS.REDACT_PATHS expansion logic', () => {
            // Verify it correctly maps headers to req.headers paths
            // 'authorization' -> 'req.headers.authorization'
            // 'x-api-key' -> "req.headers['x-api-key']"
            expect(LOG_CONSTS.REDACT_PATHS).toContain('req.headers.authorization');
            expect(LOG_CONSTS.REDACT_PATHS).toContain("req.headers['x-api-key']");
            expect(LOG_CONSTS.REDACT_PATHS).toContain('body.password');
        });

        it('should verify SSRF_BLOCKED_RANGES contains standard private networks', () => {
            expect(SSRF_BLOCKED_RANGES).toContain('127.0.0.0/8'); // Localhost
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(SSRF_BLOCKED_RANGES).toContain('10.0.0.0/8');  // Private A
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(SSRF_BLOCKED_RANGES).toContain('192.168.0.0/16'); // Private C
            // eslint-disable-next-line sonarjs/no-hardcoded-ip
            expect(SSRF_BLOCKED_RANGES).toContain('169.254.169.254/32'); // Metadata
        });

        it('should verify UNAUTHORIZED_HTML_TEMPLATE contains required placeholders', () => {
            // ui.js doesn't use the DASHBOARD_PLACEHOLDERS enum keys for the unauthorized template directly, 
            // but hardcoded strings. Let's verify the strings exist.
            expect(UNAUTHORIZED_HTML_TEMPLATE).toContain('{{ERROR_MESSAGE}}');
            expect(UNAUTHORIZED_HTML_TEMPLATE).toContain('{{APIFY_HOMEPAGE_URL}}');
        });

        it('should verify SQL_CONSTS operators map allows valid SQL comparison', () => {
            expect(SQL_CONSTS.OPERATOR_MAP.eq).toBe('=');
            expect(SQL_CONSTS.OPERATOR_MAP.gte).toBe('>=');
            expect(SQL_CONSTS.OPERATOR_MAP.ne).toBe('!=');
            expect(SQL_CONSTS.OPERATOR_MAP.lte).toBe('<=');
            expect(SQL_CONSTS.OPERATOR_MAP.gt).toBe('>');
            expect(SQL_CONSTS.OPERATOR_MAP.lt).toBe('<');
            expect(SQL_CONSTS.VALID_OPERATORS).toContain('eq');
            expect(SQL_CONSTS.VALID_OPERATORS).toContain('gte');
            expect(SQL_CONSTS.VALID_OPERATORS).toContain('ne');
            expect(SQL_CONSTS.VALID_OPERATORS).toContain('lte');
            expect(SQL_CONSTS.VALID_OPERATORS).toContain('gt');
            expect(SQL_CONSTS.VALID_OPERATORS).toContain('lt');
        });
    });
});


describe('Top-level Branch Coverage', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
    });

    const mockApify = ({ isAtHome = false, env = {} } = {}) => {
        jest.unstable_mockModule('apify', () => ({
            Actor: {
                isAtHome: () => isAtHome,
                getEnv: () => env
            }
        }));
    };

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    describe('src/consts/database.js', () => {
        it('should set SYNC_MAX_CONCURRENT to 1 when Actor is at home', async () => {
            mockApify({ isAtHome: true });

            const { SYNC_MAX_CONCURRENT } = await import('../../src/consts/database.js');
            expect(SYNC_MAX_CONCURRENT).toBe(1);
        });

        it('should set SYNC_MAX_CONCURRENT to 5 when Actor is NOT at home', async () => {
            mockApify({ isAtHome: false });

            const { SYNC_MAX_CONCURRENT } = await import('../../src/consts/database.js');
            expect(SYNC_MAX_CONCURRENT).toBe(1 + 1 + 1 + 1 + 1);
        });

        it('should use DUCKDB_FILENAME from env if present', async () => {
            process.env.DUCKDB_FILENAME = 'custom.db';
            mockApify({ isAtHome: false });

            const { DUCKDB_FILENAME_DEFAULT } = await import('../../src/consts/database.js');
            expect(DUCKDB_FILENAME_DEFAULT).toBe('custom.db');
        });
    });



    describe('src/consts/storage.js', () => {
        it('should use DUCKDB_STORAGE_DIR from env if present', async () => {
            process.env[ENV_VARS.DUCKDB_STORAGE_DIR] = '/custom/duckdb';
            const { DEFAULT_STORAGE_DIR } = await import('../../src/consts/storage.js');
            expect(DEFAULT_STORAGE_DIR).toBe('/custom/duckdb');
        });

        it('should use APIFY_LOCAL_STORAGE_DIR from env if DUCKDB_STORAGE_DIR is missing', async () => {
            delete process.env[ENV_VARS.DUCKDB_STORAGE_DIR];
            process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR] = '/custom/apify';
            const { DEFAULT_STORAGE_DIR } = await import('../../src/consts/storage.js');
            expect(DEFAULT_STORAGE_DIR).toBe('/custom/apify');
        });

        it('should fall back to ./storage if neither env var is present', async () => {
            delete process.env[ENV_VARS.DUCKDB_STORAGE_DIR];
            delete process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR];
            const { DEFAULT_STORAGE_DIR } = await import('../../src/consts/storage.js');
            expect(DEFAULT_STORAGE_DIR).toBe('./storage');
        });
    });

    describe('src/consts/database.js', () => {
        beforeEach(() => {
            jest.resetModules();
            process.env = { ...ORIGINAL_ENV };
        });

        it('should use DUCKDB_FILENAME from env if provided', async () => {
            process.env[ENV_VARS.DUCKDB_FILENAME] = 'custom.db';
            const { DUCKDB_FILENAME_DEFAULT } = await import('../../src/consts/database.js');
            expect(DUCKDB_FILENAME_DEFAULT).toBe('custom.db');
        });

        it('should use default filename if DUCKDB_FILENAME is not provided', async () => {
            delete process.env[ENV_VARS.DUCKDB_FILENAME];
            const { DUCKDB_FILENAME_DEFAULT } = await import('../../src/consts/database.js');
            expect(DUCKDB_FILENAME_DEFAULT).toBe('logs.duckdb');
        });
    });

    describe('src/consts/http.js', () => {
        it('should fallback to HTTP 200 if inputSchema default is missing', async () => {
            jest.unstable_mockModule('module', () => ({
                createRequire: () =>
                    /**
                     * @param {string} path
                     * @returns {object}
                     */
                    (path) => {
                        if (path.includes('actor.json')) {
                            return {
                                environmentVariables: {
                                    ACTOR_WEB_SERVER_PORT: '3000'
                                }
                            };
                        }
                        // Default to input_schema.json mock
                        return {
                            properties: {
                                defaultResponseCode: {}, // Critical: Missing default to test fallback
                                // Minimal set to satisfy src/consts/app.js
                                urlCount: { default: 100 },
                                retentionHours: { default: 24 },
                                rateLimitPerMinute: { default: 60 },
                                maxPayloadSize: { default: 1024 },
                                responseDelayMs: { default: 0 },
                                replayMaxRetries: { default: 3 },
                                replayTimeoutMs: { default: 30000 },
                                maxForwardRetries: { default: 3 },
                                useFixedMemory: { default: false },
                                fixedMemoryMbytes: { default: 256 },
                                duckdbFileName: { default: 'logs.duckdb' },
                                duckdbMemoryLimit: { default: '512MB' },
                                duckdbVacuumEnabled: { default: false },
                                maskSensitiveData: { default: true },
                                enableJSONParsing: { default: true },
                                forwardHeaders: { default: {} }
                            }
                        };
                    }
            }));

            mockApify({ env: { actorRunId: 'mock-run-id' } });

            jest.unstable_mockModule('../../src/utils/env.js', () => ({
                getInt:
                    /**
                     * @param {string} _k
                     * @param {number} v
                     * @returns {number}
                     */
                    (_k, v) => v
            }));

            const { HTTP_CONSTS, HTTP_STATUS } = await import('../../src/consts/http.js');
            expect(HTTP_CONSTS.DEFAULT_RESPONSE_CODE).toBe(HTTP_STATUS.OK);
        });
    });
});
