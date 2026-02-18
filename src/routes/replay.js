/**
 * @file src/routes/replay.js
 * @description Replay route handler for re-sending captured webhook payloads.
 * @module routes/replay
 */
import { Actor } from "apify";
import { logRepository } from "../repositories/LogRepository.js";
import { forwardingService } from "../services/index.js";
import { validateUrlForSsrf } from "../utils/ssrf.js";
import { asyncHandler } from "./utils.js";
import {
  REPLAY_HEADERS_TO_IGNORE,
  HTTP_STATUS,
  HTTP_HEADERS,
} from "../consts/http.js";
import { ERROR_MESSAGES, ERROR_LABELS, NODE_ERROR_CODES } from "../consts/errors.js";
import {
  REPLAY_STATUS_LABELS,
  APP_CONSTS,
  FORWARDING_CONSTS,
} from "../consts/app.js";
import { LOG_COMPONENTS, LOG_CONSTS } from "../consts/logging.js";
import { STORAGE_CONSTS } from "../consts/storage.js";
import { SSRF_ERRORS } from "../consts/security.js";
import { SQL_CONSTS } from "../consts/database.js";
import { LOG_MESSAGES } from "../consts/messages.js";
import { createChildLogger, serializeError } from "../utils/logger.js";

const log = createChildLogger({ component: LOG_COMPONENTS.REPLAY });

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("axios").AxiosResponse} AxiosResponse
 * @typedef {import("../typedefs.js").CommonError} CommonError
 * @typedef {Object.<string, string> | null} ReqBody
 */

/**
 * Creates the replay route handler.
 * @param {() => number | undefined} [getReplayMaxRetries]
 * @param {() => number | undefined} [getReplayTimeoutMs]
 * @returns {RequestHandler}
 */
export const createReplayHandler = (getReplayMaxRetries, getReplayTimeoutMs) =>
  asyncHandler(
    /** @param {Request} req @param {Response} res */
    async (req, res) => {
      let maxRetries = APP_CONSTS.MAX_REPLAY_RETRIES;
      let replayTimeout = APP_CONSTS.DEFAULT_REPLAY_TIMEOUT_MS;

      try {
        /** @type {{webhookId?: string, itemId?: string}} */
        const { webhookId = "", itemId = "" } = req.params;
        let targetUrl = req.query.url;

        maxRetries = getReplayMaxRetries
          ? (getReplayMaxRetries() ?? maxRetries)
          : maxRetries;
        replayTimeout = getReplayTimeoutMs
          ? (getReplayTimeoutMs() ?? replayTimeout)
          : replayTimeout;

        if (Array.isArray(targetUrl)) {
          targetUrl = targetUrl[0];
        }
        if (!targetUrl) {
          res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json({ error: ERROR_MESSAGES.MISSING_URL });
          return;
        }

        // Validate URL and check for SSRF
        const ssrfResult = await validateUrlForSsrf(String(targetUrl));
        if (!ssrfResult.safe) {
          if (ssrfResult.error === SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED) {
            res
              .status(HTTP_STATUS.BAD_REQUEST)
              .json({ error: ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED });
            return;
          }
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ssrfResult.error });
          return;
        }

        const target = {
          href: ssrfResult.href,
          host: ssrfResult.host,
        };

        let item = await logRepository.getLogById(itemId);

        // Fallback: Try to find by timestamp if ID not found (and ID looks like a date)
        if (!item && !isNaN(Date.parse(itemId))) {
          const { items } = await logRepository.findLogs({
            timestamp: [{ operator: SQL_CONSTS.OPERATORS.EQ, value: itemId }],
            webhookId, // Ensure it matches the webhook
            limit: 1,
          });
          if (items.length > 0) {
            item = items[0];
          }
        }

        if (!item) {
          res
            .status(HTTP_STATUS.NOT_FOUND)
            .json({ error: ERROR_MESSAGES.EVENT_NOT_FOUND });
          return;
        }

        /** @type {Readonly<string[]>} */
        const headersToIgnore = REPLAY_HEADERS_TO_IGNORE;
        /** @type {string[]} */
        const strippedHeaders = [];
        /** @type {Record<string, unknown>} */
        const filteredHeaders = Object.entries(item.headers || {}).reduce(
          (/** @type {Record<string, unknown>} */ acc, [key, value]) => {
            const lowerKey = key.toLowerCase();
            const isMasked =
              typeof value === "string" &&
              value.toUpperCase() === LOG_CONSTS.MASKED_VALUE;
            if (isMasked || headersToIgnore.includes(lowerKey)) {
              strippedHeaders.push(key);
            } else {
              acc[key] = value;
            }
            return acc;
          },
          {},
        );

        /** @type {ReqBody} */
        let bodyToSend = /** @type {ReqBody} */ (item.body);

        // Hydrate large payloads from KVS if necessary
        if (
          bodyToSend &&
          typeof bodyToSend === "object" &&
          /** @type {string[]} */ ([
            STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
            STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
          ]).includes(bodyToSend.data) &&
          bodyToSend.key
        ) {
          log.info({ kvsKey: bodyToSend.key }, LOG_MESSAGES.HYDRATING_PAYLOAD);
          try {
            /** @type {ReqBody} */
            const hydrated = await Actor.getValue(bodyToSend.key);
            if (hydrated) {
              bodyToSend = hydrated;
            } else {
              log.warn(
                { kvsKey: bodyToSend.key },
                LOG_MESSAGES.HYDRATE_FAILED_KEY,
              );
            }
          } catch (e) {
            log.error(
              { kvsKey: bodyToSend.key, err: serializeError(e) },
              LOG_MESSAGES.HYDRATE_ERROR,
            );
          }
        }

        /** @type {AxiosResponse | undefined} */
        let response;
        const replayAbort = new AbortController();
        const totalTimeoutMs = replayTimeout * (maxRetries + 1);
        const replayTimeoutId = setTimeout(
          () => replayAbort.abort(),
          totalTimeoutMs,
        );

        try {
          response = await forwardingService.sendSafeRequest(
            String(target.href),
            item.method,
            bodyToSend,
            {
              ...filteredHeaders,
              [HTTP_HEADERS.APIFY_REPLAY]: String(true),
              [HTTP_HEADERS.ORIGINAL_WEBHOOK_ID]: webhookId,
              [HTTP_HEADERS.IDEMPOTENCY_KEY]: itemId,
            },
            {
              maxRetries,
              hostHeader: target.host,
              forwardHeaders: true, // We manually filtered headers above
              timeout: replayTimeout,
            },
            replayAbort.signal,
          );
        } catch (err) {
          const axiosError = /** @type {CommonError} */ (err);

          if (axiosError.response) {
            response = /** @type {AxiosResponse} */ (axiosError.response); // It was a non-2xx response, but we got one.
          } else {
            throw err; // Real network error / timeout
          }
        } finally {
          clearTimeout(replayTimeoutId);
        }

        if (!response) {
          res.status(HTTP_STATUS.GATEWAY_TIMEOUT).json({
            error: ERROR_LABELS.REPLAY_FAILED,
            message: ERROR_MESSAGES.REPLAY_ATTEMPTS_EXHAUSTED(maxRetries),
          });
          return;
        }

        if (strippedHeaders.length > 0) {
          res.setHeader(
            HTTP_HEADERS.APIFY_REPLAY_WARNING,
            `${LOG_MESSAGES.STRIPPED_HEADERS_WARNING}: ${strippedHeaders.join(
              ", ",
            )}`,
          );
        }

        res.json({
          status: REPLAY_STATUS_LABELS.REPLAYED,
          targetUrl,
          targetResponseCode: response?.status,
          targetResponseBody: response?.data,
          strippedHeaders:
            strippedHeaders.length > 0 ? strippedHeaders : undefined,
        });
      } catch (error) {
        const axiosError = /** @type {CommonError} */ (error);
        const isTimeout =
          (axiosError.code &&
            FORWARDING_CONSTS.TIMEOUT_CODES.includes(axiosError.code)) ||
          axiosError.message === ERROR_MESSAGES.ABORTED ||
          axiosError.name === NODE_ERROR_CODES.ABORT_ERROR;
        res
          .status(
            isTimeout
              ? HTTP_STATUS.GATEWAY_TIMEOUT
              : HTTP_STATUS.INTERNAL_SERVER_ERROR,
          )
          .json({
            error: ERROR_LABELS.REPLAY_FAILED,
            message: isTimeout
              ? ERROR_MESSAGES.REPLAY_TIMEOUT(maxRetries, replayTimeout)
              : axiosError.message,
            code: axiosError.code,
          });
      }
    },
  );
