/**
 * @file tests/unit/alerting.test.js
 * @description Unit tests for alerting utilities.
 */

import { jest } from '@jest/globals';
import { setupCommonMocks } from '../setup/helpers/mock-setup.js';
import { loggerMock, axiosMock } from '../setup/helpers/shared-mocks.js';
import { ALERT_TRIGGERS } from '../../src/consts/alerting.js';

// Mock dependencies
const mockValidateUrlForSsrf = jest.fn();
jest.unstable_mockModule('../../src/utils/ssrf.js', () => ({
    validateUrlForSsrf: mockValidateUrlForSsrf
}));

// Setup shared mocks
await setupCommonMocks({ logger: true, axios: true });

await jest.resetModules();

// Import module under test
const { shouldAlert, sendAlert, triggerAlertIfNeeded } = await import('../../src/utils/alerting.js');

describe('Alerting Utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockValidateUrlForSsrf.mockResolvedValue({ safe: true });
        axiosMock.post.mockResolvedValue({ status: 200 });
    });

    describe('shouldAlert', () => {
        const config = { alertOn: [ALERT_TRIGGERS.ERROR, ALERT_TRIGGERS.STATUS_5XX] };

        it('should return true for ERROR trigger', () => {
            expect(shouldAlert(config, { error: 'Something went wrong' })).toBe(true);
        });

        it('should return true for STATUS_5XX trigger', () => {
            expect(shouldAlert(config, { statusCode: 500 })).toBe(true);
            expect(shouldAlert(config, { statusCode: 503 })).toBe(true);
        });

        it('should return true for STATUS_4XX trigger', () => {
            const config4xx = { alertOn: [ALERT_TRIGGERS.STATUS_4XX] };
            expect(shouldAlert(config4xx, { statusCode: 400 })).toBe(true);
            expect(shouldAlert(config4xx, { statusCode: 404 })).toBe(true);
            expect(shouldAlert(config4xx, { statusCode: 499 })).toBe(true);
            expect(shouldAlert(config4xx, { statusCode: 500 })).toBe(false);
            expect(shouldAlert(config4xx, { statusCode: 200 })).toBe(false);
        });

        it('should return false if trigger condition not met', () => {
            expect(shouldAlert(config, { statusCode: 200 })).toBe(false);
            expect(shouldAlert(config, { statusCode: 404 })).toBe(false); // 4XX not in config
        });

        it('should use default triggers if config.alertOn is missing', () => {
            const emptyConfig = {};
            // Default usually includes ERROR and maybe 5XX? let's check CONST behavior
            // We assume defaults cover at least Errors.
            expect(shouldAlert(emptyConfig, { error: 'Fail' })).toBe(true);
        });

        it('should handle TIMEOUT trigger', () => {
            const timeoutConfig = { alertOn: [ALERT_TRIGGERS.TIMEOUT] };
            expect(shouldAlert(timeoutConfig, { error: 'Request timeout occurred' })).toBe(true);
            expect(shouldAlert(timeoutConfig, { error: 'Other error' })).toBe(false);
            expect(shouldAlert(timeoutConfig, {})).toBe(false); // Hits context.error || "" branch
        });

        it('should handle SIGNATURE_INVALID trigger', () => {
            const sigConfig = { alertOn: [ALERT_TRIGGERS.SIGNATURE_INVALID] };
            expect(shouldAlert(sigConfig, { signatureValid: false })).toBe(true);
            expect(shouldAlert(sigConfig, { signatureValid: true })).toBe(false);
        });
    });

    describe('sendAlert', () => {
        const context = {
            webhookId: 'hook-123',
            method: 'POST',
            statusCode: 500,
            error: 'Internal Server Error',
            timestamp: '2023-01-01T00:00:00Z',
            sourceIp: '1.2.3.4'
        };

        it('should send alerts to configured channels', async () => {
            const config = {
                slack: { webhookUrl: 'https://hooks.slack.com/services/XXX' },
                discord: { webhookUrl: 'https://discord.com/api/webhooks/YYY' }
            };

            const results = await sendAlert(config, context);

            expect(mockValidateUrlForSsrf).toHaveBeenCalledTimes(2);
            expect(axiosMock.post).toHaveBeenCalledTimes(2);
            expect(results.slack).toBe(true);
            expect(results.discord).toBe(true);
        });

        it('should block SSRF URLs', async () => {
            mockValidateUrlForSsrf.mockResolvedValueOnce({ safe: false, error: 'Blocked IP' });

            const config = {
                slack: { webhookUrl: 'http://169.254.169.254/latest' }
            };

            await sendAlert(config, context);

            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.anything() }),
                expect.stringContaining('Slack notification failed')
            );
            expect(axiosMock.post).not.toHaveBeenCalled();
        });

        it('should block SSRF URLs for Discord', async () => {
            mockValidateUrlForSsrf.mockResolvedValueOnce({ safe: false, error: 'Blocked IP' });

            const config = {
                discord: { webhookUrl: 'http://169.254.169.254/latest' }
            };

            await sendAlert(config, context);

            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.anything() }),
                expect.stringContaining('Discord notification failed')
            );
            expect(axiosMock.post).not.toHaveBeenCalled();
        });

        it('should handle axios errors', async () => {
            axiosMock.post.mockRejectedValueOnce(new Error('Network Error'));

            const config = {
                slack: { webhookUrl: 'https://hooks.slack.com/services/XXX' }
            };

            const results = await sendAlert(config, context);

            expect(results.slack).toBe(false);
            expect(loggerMock.error).toHaveBeenCalled();
        });

        it('should handle axios errors for Discord', async () => {
            axiosMock.post.mockRejectedValueOnce(new Error('Network Error'));

            const config = {
                discord: { webhookUrl: 'https://discord.com/api/webhooks/YYY' }
            };

            const results = await sendAlert(config, context);

            expect(results.discord).toBe(false);
            expect(loggerMock.error).toHaveBeenCalled();
        });

        it('should format Slack message for invalid signatures correctly', async () => {
            const config = { slack: { webhookUrl: 'https://hooks.slack.com/services/XXX' } };
            const sigContext = { ...context, error: undefined, signatureValid: false, signatureError: 'Mismatch' };

            await sendAlert(config, sigContext);
            expect(axiosMock.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    blocks: expect.arrayContaining([
                        expect.objectContaining({
                            text: expect.objectContaining({ text: expect.stringContaining('⚠️') })
                        }),
                        expect.objectContaining({
                            fields: expect.arrayContaining([
                                expect.objectContaining({ text: expect.stringContaining('Signature Invalid: Mismatch') })
                            ])
                        })
                    ])
                }),
                expect.any(Object)
            );
        });

        it('should format Discord message for invalid signatures correctly', async () => {
            const config = { discord: { webhookUrl: 'https://discord.com/api/webhooks/YYY' } };
            const sigContext = { ...context, error: undefined, signatureValid: false, signatureError: 'Mismatch' };
            const DISCORD_ORANGE = 16753920;

            await sendAlert(config, sigContext);
            expect(axiosMock.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            color: DISCORD_ORANGE,
                            fields: expect.arrayContaining([
                                expect.objectContaining({ value: expect.stringContaining('Signature Invalid: Mismatch') })
                            ])
                        })
                    ])
                }),
                expect.any(Object)
            );
        });

        it('should format message for default OK status correctly (Slack/Discord)', async () => {
            const config = {
                slack: { webhookUrl: 'https://hooks.slack.com/services/XXX' },
                discord: { webhookUrl: 'https://discord.com/api/webhooks/YYY' }
            };
            const okContext = { ...context, error: undefined, signatureValid: true, statusCode: 200, sourceIp: undefined };
            const DISCORD_GREEN = 65280;

            await sendAlert(config, okContext);

            // Checking Discord default status
            expect(axiosMock.post).toHaveBeenCalledWith(
                'https://discord.com/api/webhooks/YYY',
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            color: DISCORD_GREEN,
                            fields: expect.arrayContaining([
                                expect.objectContaining({ value: 'Status: 200' })
                            ])
                        })
                    ])
                }),
                expect.any(Object)
            );

            // Checking Slack default status
            expect(axiosMock.post).toHaveBeenCalledWith(
                'https://hooks.slack.com/services/XXX',
                expect.objectContaining({
                    blocks: expect.arrayContaining([
                        expect.objectContaining({
                            text: expect.objectContaining({ text: expect.stringContaining('📩') })
                        }),
                        expect.objectContaining({
                            fields: expect.arrayContaining([
                                expect.objectContaining({ text: expect.stringContaining('Status: 200') })
                            ])
                        })
                    ])
                }),
                expect.any(Object)
            );
        });
    });

    describe('triggerAlertIfNeeded', () => {
        it('should trigger alert if conditions met', async () => {
            const config = {
                alertOn: [ALERT_TRIGGERS.ERROR],
                slack: { webhookUrl: 'https://slack.com' }
            };
            const context = { error: 'Fail' };

            await triggerAlertIfNeeded(config, context);

            expect(axiosMock.post).toHaveBeenCalled();
        });

        it('should skip alert if no channels configured', async () => {
            const config = { alertOn: [ALERT_TRIGGERS.ERROR] }; // No URLs
            const context = { error: 'Fail' };

            await triggerAlertIfNeeded(config, context);

            expect(axiosMock.post).not.toHaveBeenCalled();
        });

        it('should skip alert if condition not met', async () => {
            const config = {
                alertOn: [ALERT_TRIGGERS.ERROR],
                slack: { webhookUrl: 'https://slack.com' }
            };
            const context = { statusCode: 200 }; // No error

            await triggerAlertIfNeeded(config, context);

            expect(axiosMock.post).not.toHaveBeenCalled();
        });

        it('should exit cleanly if config is undefined', async () => {
            await triggerAlertIfNeeded(undefined, { error: 'Fail' });
            expect(axiosMock.post).not.toHaveBeenCalled();
        });
    });
});
