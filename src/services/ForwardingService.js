/**
 * @file src/services/ForwardingService.js
 * @description Handles reliable webhook forwarding with retries, SSRF protection,
 * connection pooling, and circuit breaking for target stability.
 * @module services/ForwardingService
 */
import { Actor } from "apify";
import axios from "axios";
import http from "http";
import https from "https";
import { nanoid } from "nanoid";
import { validateUrlForSsrf } from "../utils/ssrf.js";
import { LOG_COMPONENTS } from "../consts/logging.js";
import {
  ERROR_MESSAGES,
  ERROR_LABELS,
  NODE_ERROR_CODES,
} from "../consts/errors.js";
import { FORWARDING_CONSTS, APP_CONSTS, SYSTEM_CONSTS } from "../consts/app.js";
import {
  HTTP_STATUS,
  HTTP_HEADERS,
  RECURSION_HEADER_NAME,
  RECURSION_HEADER_VALUE,
  FORWARD_HEADERS_TO_IGNORE,
  HTTP_METHODS,
} from "../consts/http.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { createChildLogger, serializeError } from "../utils/logger.js";
import { PROTOCOL_PREFIXES } from "../consts/network.js";
import { CircuitBreaker } from "./CircuitBreaker.js";

const log = createChildLogger({ component: LOG_COMPONENTS.FORWARDING_SERVICE });

/**
 * @typedef {import('axios').AxiosInstance} AxiosInstance
 * @typedef {import('axios').AxiosResponse} AxiosResponse
 * @typedef {import('http').IncomingHttpHeaders} IncomingHttpHeaders
 * @typedef {import('../typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../typedefs.js').LoggerOptions} LoggerOptions
 * @typedef {import('express').Request} Request
 * @typedef {import('../typedefs.js').CommonError} CommonError
 */

export class ForwardingService {
  constructor() {
    /** @type {CircuitBreaker} */
    this.circuitBreaker = new CircuitBreaker();

    // Connection Pooling for Performance
    /** @type {AxiosInstance} */
    this.axiosInstance = axios.create({
      httpAgent: new http.Agent({
        keepAlive: true,
        maxSockets: FORWARDING_CONSTS.CONNECTION_POOL_MAX_SOCKETS,
        maxFreeSockets: FORWARDING_CONSTS.CONNECTION_POOL_MAX_FREE_SOCKETS,
        timeout: FORWARDING_CONSTS.FORWARD_TIMEOUT_MS,
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: FORWARDING_CONSTS.CONNECTION_POOL_MAX_SOCKETS,
        maxFreeSockets: FORWARDING_CONSTS.CONNECTION_POOL_MAX_FREE_SOCKETS,
        timeout: FORWARDING_CONSTS.FORWARD_TIMEOUT_MS,
      }),
      timeout: FORWARDING_CONSTS.FORWARD_TIMEOUT_MS,
      maxRedirects: 0, // Security: Prevent open redirection
      validateStatus: null, // Allow all status codes passing network layer, we validate manually
    });
  }

  /**
   * Executes a safe HTTP request with retries, circuit breaker, and connection pooling.
   * @param {string} url
   * @param {string} method
   * @param {any} body
   * @param {IncomingHttpHeaders} headers
   * @param {object} options
   * @param {number} [options.maxRetries]
   * @param {string} [options.hostHeader]
   * @param {boolean} [options.forwardHeaders]
   * @param {number} [options.timeout]
   * @param {AbortSignal} [signal]
   * @returns {Promise<AxiosResponse>}
   */
  async sendSafeRequest(
    url,
    method,
    body,
    headers,
    {
      maxRetries = APP_CONSTS.DEFAULT_FORWARD_RETRIES,
      hostHeader,
      forwardHeaders,
      timeout, // Support per-request timeout
    },
    signal,
  ) {
    let attempt = 0;

    while (attempt < maxRetries) {
      // Abort check before attempt
      if (signal?.aborted) {
        log.info(LOG_MESSAGES.FORWARD_ABORTED);
        throw new Error(ERROR_MESSAGES.ABORTED); // Propagate up
      }

      try {
        attempt++;

        /** @type {Readonly<string[]>} */
        const sensitiveHeaders = FORWARD_HEADERS_TO_IGNORE;

        const requestHeaders =
          forwardHeaders !== false
            ? Object.fromEntries(
                Object.entries(headers).filter(
                  ([key]) => !sensitiveHeaders.includes(key.toLowerCase()),
                ),
              )
            : {
                [HTTP_HEADERS.CONTENT_TYPE]: headers[HTTP_HEADERS.CONTENT_TYPE],
              };

        // Execute Request
        const response = await this.axiosInstance.request({
          method,
          url,
          data: body,
          headers: {
            ...requestHeaders,
            [RECURSION_HEADER_NAME]: RECURSION_HEADER_VALUE,
            ...(hostHeader ? { [HTTP_HEADERS.HOST]: hostHeader } : {}),
          },
          timeout, // Apply per-request timeout
          signal, // Pass abort signal to axios
        });

        // Manual Status Validation (2xx check)
        if (
          response.status < HTTP_STATUS.OK ||
          response.status >= HTTP_STATUS.MULTIPLE_CHOICES
        ) {
          throw {
            code: `${FORWARDING_CONSTS.HTTP_PREFIX}${response.status}`,
            message: ERROR_MESSAGES.FORWARD_REQUEST_FAILED_STATUS(
              response.status,
            ),
            isHttpError: true,
            response, // Attach response for caller inspection
          };
        }

        this.circuitBreaker.recordSuccess(url);
        return response;
      } catch (err) {
        const axiosError = /** @type {CommonError} */ (err);

        // Don't count cancellation as a failure
        if (axios.isCancel(err) || signal?.aborted) {
          throw err;
        }

        const isHttpError = !!axiosError.isHttpError; // From our manual throw
        let isTransient = false;

        if (isHttpError) {
          const status = parseInt(
            String(axiosError.code?.split(FORWARDING_CONSTS.HTTP_PREFIX)?.[1]),
            10,
          );
          if (
            status === HTTP_STATUS.INTERNAL_SERVER_ERROR ||
            status === HTTP_STATUS.BAD_GATEWAY ||
            status === HTTP_STATUS.SERVICE_UNAVAILABLE ||
            status === HTTP_STATUS.GATEWAY_TIMEOUT
          ) {
            isTransient = true;
          }
        } else {
          isTransient = FORWARDING_CONSTS.TRANSIENT_ERROR_CODES.includes(
            String(axiosError.code),
          );
        }

        // CB should trip on any persistent failure to that host.
        if (!isTransient || attempt >= maxRetries) {
          this.circuitBreaker.recordFailure(url);
        }

        const delay =
          FORWARDING_CONSTS.RETRY_BASE_DELAY_MS *
          Math.pow(FORWARDING_CONSTS.RETRY_BACKOFF_BASE, attempt - 1);

        log.error(
          {
            attempt,
            maxRetries,
            url,
            code: axiosError.code,
            err: serializeError(err),
          },
          axiosError.code === FORWARDING_CONSTS.TIMEOUT_CODE
            ? ERROR_MESSAGES.FORWARD_TIMEOUT
            : ERROR_MESSAGES.FORWARD_FAILED,
        );

        if (attempt >= maxRetries || !isTransient) {
          // Re-throw the error for the caller to handle (logging/response)
          throw axiosError;
        } else {
          // Non-blocking wait (abort-aware)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            if (signal) {
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(new Error(ERROR_MESSAGES.ABORTED));
                },
                { once: true },
              );
            }
            if (timer.unref) timer.unref();
          });
        }
      }
    }
    throw new Error(ERROR_MESSAGES.FORWARD_FAILED); // Should be unreachable if loop works
  }

  /**
   * Wrapper for background forwarding that handles Actor logging
   * @param {WebhookEvent} event
   * @param {Request} req
   * @param {LoggerOptions} options
   * @param {string} forwardUrl
   * @param {AbortSignal} [signal]
   */
  async forwardWebhook(event, req, options, forwardUrl, signal) {
    let validatedUrl = Object.values(PROTOCOL_PREFIXES).some((prefix) =>
      forwardUrl.startsWith(prefix),
    )
      ? forwardUrl
      : `${PROTOCOL_PREFIXES.HTTP}${forwardUrl}`;

    // 1. Circuit Breaker Check
    if (this.circuitBreaker.isOpen(validatedUrl)) {
      log.warn({ url: validatedUrl }, LOG_MESSAGES.CIRCUIT_BREAKER_OPEN);
      return;
    }

    // 2. SSRF Validation
    const ssrfResult = await validateUrlForSsrf(validatedUrl);
    if (!ssrfResult.safe) {
      log.error(
        { url: validatedUrl, error: ssrfResult.error },
        LOG_MESSAGES.SSRF_BLOCKED,
      );
      return;
    }
    const hostHeader = ssrfResult.host || "";
    validatedUrl = ssrfResult.href || validatedUrl;

    // 3. Defensive Body Size Check
    const MAX_FORWARD_BODY = APP_CONSTS.MAX_ALLOWED_PAYLOAD_SIZE;
    let bodySize = 0;
    if (req.headers[HTTP_HEADERS.CONTENT_LENGTH]) {
      bodySize = parseInt(String(req.headers[HTTP_HEADERS.CONTENT_LENGTH]), 10);
    } else {
      if (Buffer.isBuffer(req.body)) {
        bodySize = req.body.length;
      } else if (typeof req.body === "string") {
        bodySize = Buffer.byteLength(req.body);
      } else {
        try {
          bodySize = Buffer.byteLength(JSON.stringify(req.body));
        } catch {
          bodySize = 0;
        }
      }
    }

    if (bodySize > MAX_FORWARD_BODY) {
      log.warn(
        { size: bodySize, limit: MAX_FORWARD_BODY },
        LOG_MESSAGES.FORWARD_PAYLOAD_TOO_LARGE,
      );
      return;
    }

    const maxRetries =
      options.maxForwardRetries ?? APP_CONSTS.DEFAULT_FORWARD_RETRIES;

    try {
      await this.sendSafeRequest(
        validatedUrl,
        HTTP_METHODS.POST,
        req.body,
        req.headers,
        {
          hostHeader,
          maxRetries,
          forwardHeaders: options.forwardHeaders,
        },
        signal,
      );
    } catch (err) {
      // Handle logging to Actor for background failures
      const axiosError = /** @type {CommonError} */ (err);

      if (axios.isCancel(err) || signal?.aborted) return;

      // Sanitize error message to prevent leakage - Allowlist specific codes
      const SAFE_CODES = [
        ...FORWARDING_CONSTS.TRANSIENT_ERROR_CODES,
        NODE_ERROR_CODES.ERR_BAD_REQUEST,
        NODE_ERROR_CODES.ERR_BAD_RESPONSE,
      ];

      // Stricter Sanitization: Only allow safe codes or generic message
      let safeErrorMessage;
      const isHttpError = !!axiosError.isHttpError;
      if (isHttpError) {
        // HTTP errors from axios can contain full URLs in .message, so we use the code.
        safeErrorMessage =
          axiosError.code ||
          ERROR_MESSAGES.FORWARD_REQUEST_FAILED_STATUS(
            axiosError.response?.status || 0,
          );
      } else if (SAFE_CODES.includes(String(axiosError.code))) {
        safeErrorMessage = axiosError.code; // Just the code, no message details
      } else {
        safeErrorMessage = ERROR_MESSAGES.FORWARD_REQUEST_FAILED;
      }

      let isTransientFailure = false;
      if (isHttpError) {
        const status = axiosError.response?.status;
        if (
          status === HTTP_STATUS.INTERNAL_SERVER_ERROR ||
          status === HTTP_STATUS.BAD_GATEWAY ||
          status === HTTP_STATUS.SERVICE_UNAVAILABLE ||
          status === HTTP_STATUS.GATEWAY_TIMEOUT
        ) {
          isTransientFailure = true;
        }
      } else {
        isTransientFailure = FORWARDING_CONSTS.TRANSIENT_ERROR_CODES.includes(
          String(axiosError.code),
        );
      }

      try {
        await Actor.pushData({
          id: nanoid(APP_CONSTS.DEFAULT_ID_LENGTH),
          timestamp: new Date().toISOString(),
          webhookId: event.webhookId,
          method: SYSTEM_CONSTS.SYNC_ENTITY_SYSTEM,
          type: ERROR_LABELS.FORWARD_ERROR,
          body: ERROR_MESSAGES.FORWARD_FAILURE_DETAILS(
            validatedUrl,
            isTransientFailure,
            maxRetries,
            String(safeErrorMessage),
          ),
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          originalEventId: event.id,
        }).catch((e) =>
          log.error(
            { err: serializeError(e) },
            LOG_MESSAGES.FAILED_LOG_FORWARD,
          ),
        );
        // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (_loggingErr) {
        // Ignore logging errors to prevent infinite loops (since we are logging an error about logging)
      }
    }
  }
}
