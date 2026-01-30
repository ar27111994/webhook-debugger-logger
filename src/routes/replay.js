/**
 * @file src/routes/replay.js
 * @description Replay route handler for re-sending captured webhook payloads.
 * @module routes/replay
 */
import axios from "axios";
import { Actor } from "apify";
import { logRepository } from "../repositories/LogRepository.js";
import { validateUrlForSsrf, SSRF_ERRORS } from "../utils/ssrf.js";
import { asyncHandler } from "./utils.js";
import {
  REPLAY_HEADERS_TO_IGNORE,
  DEFAULT_REPLAY_RETRIES as MAX_REPLAY_RETRIES,
  DEFAULT_REPLAY_TIMEOUT_MS as REPLAY_TIMEOUT_MS,
  ERROR_MESSAGES,
  TRANSIENT_ERROR_CODES,
} from "../consts.js";
import {
  OFFLOAD_MARKER_SYNC,
  OFFLOAD_MARKER_STREAM,
} from "../utils/storage_helper.js";
import { createChildLogger, serializeError } from "../utils/logger.js";

const log = createChildLogger({ component: "Replay" });

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
      let maxRetries = MAX_REPLAY_RETRIES;
      let replayTimeout = REPLAY_TIMEOUT_MS;

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
          res.status(400).json({ error: "Missing 'url' parameter" });
          return;
        }

        // Validate URL and check for SSRF
        const ssrfResult = await validateUrlForSsrf(String(targetUrl));
        if (!ssrfResult.safe) {
          if (ssrfResult.error === SSRF_ERRORS.HOSTNAME_RESOLUTION_FAILED) {
            res
              .status(400)
              .json({ error: ERROR_MESSAGES.HOSTNAME_RESOLUTION_FAILED });
            return;
          }
          res.status(400).json({ error: ssrfResult.error });
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
            timestamp: [{ operator: "eq", value: itemId }],
            webhookId, // Ensure it matches the webhook
            limit: 1,
          });
          if (items.length > 0) {
            item = items[0];
          }
        }

        if (!item) {
          res.status(404).json({ error: "Event not found" });
          return;
        }

        const headersToIgnore = REPLAY_HEADERS_TO_IGNORE;
        /** @type {string[]} */
        const strippedHeaders = [];
        /** @type {Record<string, unknown>} */
        const filteredHeaders = Object.entries(item.headers || {}).reduce(
          (/** @type {Record<string, unknown>} */ acc, [key, value]) => {
            const lowerKey = key.toLowerCase();
            const isMasked =
              typeof value === "string" && value.toUpperCase() === "[MASKED]";
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
          [OFFLOAD_MARKER_SYNC, OFFLOAD_MARKER_STREAM].includes(
            bodyToSend.data,
          ) &&
          bodyToSend.key
        ) {
          log.info(
            { kvsKey: bodyToSend.key },
            "Hydrating offloaded payload from KVS",
          );
          try {
            /** @type {ReqBody} */
            const hydrated = await Actor.getValue(bodyToSend.key);
            if (hydrated) {
              bodyToSend = hydrated;
            } else {
              log.warn(
                { kvsKey: bodyToSend.key },
                "Failed to find KVS key, sending metadata instead",
              );
            }
          } catch (e) {
            log.error(
              { kvsKey: bodyToSend.key, err: serializeError(e) },
              "Error fetching KVS key",
            );
          }
        }

        let attempt = 0;
        /** @type {AxiosResponse | undefined} */
        let response;
        while (attempt < maxRetries) {
          try {
            attempt++;
            response = await axios({
              method: item.method,
              url: target.href,
              data: bodyToSend,
              headers: {
                ...filteredHeaders,
                "X-Apify-Replay": "true",
                "X-Original-Webhook-Id": webhookId,
                "Idempotency-Key": itemId, // Standard header using the unique event/log ID
                host: target.host,
              },
              maxRedirects: 0,
              validateStatus: () => true,
              timeout: replayTimeout,
            });
            break; // Success
          } catch (err) {
            const axiosError = /** @type {CommonError} */ (err);
            if (
              attempt >= maxRetries ||
              !TRANSIENT_ERROR_CODES.includes(axiosError.code || "")
            ) {
              throw err;
            }
            const delay = 1000 * Math.pow(2, attempt - 1);
            log.warn(
              {
                attempt,
                maxRetries,
                url: target.href,
                code: axiosError.code,
                delay,
              },
              "Replay attempt failed, retrying",
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (!response) {
          res.status(504).json({
            error: "Replay failed",
            message: `All ${maxRetries} retry attempts exhausted`,
          });
          return;
        }

        if (strippedHeaders.length > 0) {
          res.setHeader(
            "X-Apify-Replay-Warning",
            `Headers stripped (masked or transmission-related): ${strippedHeaders.join(
              ", ",
            )}`,
          );
        }

        res.json({
          status: "Replayed",
          targetUrl,
          targetResponseCode: response?.status,
          targetResponseBody: response?.data,
          strippedHeaders:
            strippedHeaders.length > 0 ? strippedHeaders : undefined,
        });
      } catch (error) {
        const axiosError = /** @type {CommonError} */ (error);
        const isTimeout =
          axiosError.code === "ECONNABORTED" || axiosError.code === "ETIMEDOUT";
        res.status(isTimeout ? 504 : 500).json({
          error: "Replay failed",
          message: isTimeout
            ? `Target destination timed out after ${maxRetries} attempts (${
                replayTimeout / 1000
              }s timeout per attempt)`
            : axiosError.message,
          code: axiosError.code,
        });
      }
    },
  );
