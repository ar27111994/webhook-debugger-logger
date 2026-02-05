/**
 * @file src/services/ForwardingService.js
 * @description Handles reliable webhook forwarding with retries and SSRF protection.
 */
import { Actor } from "apify";
import axios from "axios";
import { nanoid } from "nanoid";
import { validateUrlForSsrf } from "../utils/ssrf.js";
import {
  DEFAULT_ID_LENGTH,
  SYNC_ENTITY_SYSTEM,
  ERROR_LABELS,
  FORWARD_HEADERS_TO_IGNORE,
  FORWARD_TIMEOUT_MS,
  DEFAULT_FORWARD_RETRIES,
  TRANSIENT_ERROR_CODES,
  RETRY_BASE_DELAY_MS,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
  PROTOCOL_PREFIXES,
} from "../consts.js";
import { createChildLogger, serializeError } from "../utils/logger.js";

const log = createChildLogger({ component: "ForwardingService" });

/**
 * @typedef {import('../typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../typedefs.js').LoggerOptions} LoggerOptions
 * @typedef {import('express').Request} Request
 * @typedef {import('../typedefs.js').CommonError} CommonError
 */

export class ForwardingService {
  /**
   * Forwards a webhook event to an external URL.
   * @param {WebhookEvent} event
   * @param {Request} req
   * @param {LoggerOptions} options
   * @param {string} forwardUrl
   * @returns {Promise<void>}
   */
  async forwardWebhook(event, req, options, forwardUrl) {
    let validatedUrl = forwardUrl.startsWith("http")
      ? forwardUrl
      : `${PROTOCOL_PREFIXES.HTTP}${forwardUrl}`;

    let attempt = 0;
    let success = false;

    // SSRF validation for forwardUrl
    const ssrfResult = await validateUrlForSsrf(validatedUrl);
    if (!ssrfResult.safe) {
      log.error(
        { url: validatedUrl, error: ssrfResult.error },
        "SSRF blocked forward URL",
      );
      return;
    }
    const hostHeader = ssrfResult.host || "";
    validatedUrl = ssrfResult.href || validatedUrl;

    const maxRetries = options.maxForwardRetries ?? DEFAULT_FORWARD_RETRIES;

    while (attempt < maxRetries && !success) {
      try {
        attempt++;

        const sensitiveHeaders = FORWARD_HEADERS_TO_IGNORE;

        const forwardingHeaders =
          options.forwardHeaders !== false
            ? Object.fromEntries(
                Object.entries(req.headers).filter(
                  ([key]) => !sensitiveHeaders.includes(key.toLowerCase()),
                ),
              )
            : {
                "content-type": req.headers["content-type"],
              };

        await axios.post(validatedUrl, req.body, {
          headers: {
            ...forwardingHeaders,
            [RECURSION_HEADER_NAME]: RECURSION_HEADER_VALUE,
            host: hostHeader,
          },
          timeout: FORWARD_TIMEOUT_MS,
          maxRedirects: 0,
        });
        success = true;
      } catch (err) {
        const axiosError = /** @type {CommonError} */ (err);
        const isTransient = TRANSIENT_ERROR_CODES.includes(
          axiosError.code || "",
        );
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);

        log.error(
          {
            attempt,
            maxRetries,
            url: validatedUrl,
            code: axiosError.code,
            err: serializeError(err),
          },
          axiosError.code === "ECONNABORTED"
            ? "Forward attempt timed out"
            : "Forward attempt failed",
        );

        if (attempt >= maxRetries || !isTransient) {
          try {
            await Actor.pushData({
              id: nanoid(DEFAULT_ID_LENGTH),
              timestamp: new Date().toISOString(),
              webhookId: event.webhookId,
              method: SYNC_ENTITY_SYSTEM,
              type: ERROR_LABELS.FORWARD_ERROR,
              body: `Forwarding to ${validatedUrl} failed${
                !isTransient ? " (Non-transient error)" : ""
              } after ${attempt} attempts. Last error: ${axiosError.message}`,
              statusCode: 500,
              originalEventId: event.id,
            });
          } catch (pushErr) {
            log.error(
              { err: serializeError(pushErr) },
              "Failed to log forward error",
            );
          }
          break; // Stop retrying
        } else {
          await new Promise((resolve) => {
            const h = setTimeout(resolve, delay);
            if (h.unref) h.unref();
          });
        }
      }
    }
  }
}
