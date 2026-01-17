/**
 * Replay route handler module.
 * @module routes/replay
 */
import { Actor } from "apify";
import axios from "axios";
import { validateUrlForSsrf, SSRF_ERRORS } from "../utils/ssrf.js";
import { asyncHandler } from "./utils.js";
import {
  REPLAY_HEADERS_TO_IGNORE,
  MAX_REPLAY_RETRIES,
  REPLAY_TIMEOUT_MS,
  ERROR_MESSAGES,
} from "../consts.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("axios").AxiosResponse} AxiosResponse
 * @typedef {import("../typedefs.js").CommonError} CommonError
 */

/**
 * Creates the replay route handler.
 * @returns {RequestHandler}
 */
export const createReplayHandler = () =>
  asyncHandler(
    async (/** @param {Request} req @param {Response} res */ req, res) => {
      try {
        const { webhookId, itemId } = req.params;
        let targetUrl = req.query.url;
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

        const dataset = await Actor.openDataset();

        let item;
        let offset = 0;
        const limit = 1000;

        // Paginate through dataset (newest first) to find the event
        while (true) {
          const { items } = await dataset.getData({
            desc: true,
            limit,
            offset,
          });

          if (items.length === 0) break;

          // Prioritize exact ID match. Fallback to timestamp only if no ID matches.
          item =
            items.find((i) => i.webhookId === webhookId && i.id === itemId) ||
            items.find(
              (i) => i.webhookId === webhookId && i.timestamp === itemId,
            );

          if (item) break;

          offset += limit;
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

        let attempt = 0;
        /** @type {AxiosResponse | undefined} */
        let response;
        while (attempt < MAX_REPLAY_RETRIES) {
          try {
            attempt++;
            response = await axios({
              method: item.method,
              url: target.href,
              data: item.body,
              headers: {
                ...filteredHeaders,
                "X-Apify-Replay": "true",
                "X-Original-Webhook-Id": webhookId,
                host: target.host,
              },
              maxRedirects: 0,
              validateStatus: () => true,
              timeout: REPLAY_TIMEOUT_MS,
            });
            break; // Success
          } catch (err) {
            const axiosError = /** @type {CommonError} */ (err);
            const retryableErrors = [
              "ECONNABORTED",
              "ECONNRESET",
              "ETIMEDOUT",
              "ENOTFOUND",
              "EAI_AGAIN",
            ];
            if (
              attempt >= MAX_REPLAY_RETRIES ||
              !retryableErrors.includes(axiosError.code || "")
            ) {
              throw err;
            }
            const delay = 1000 * Math.pow(2, attempt - 1);
            console.warn(
              `[REPLAY-RETRY] Attempt ${attempt}/${MAX_REPLAY_RETRIES} failed for ${target.href}: ${axiosError.code}. Retrying in ${delay}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (!response) {
          res.status(504).json({
            error: "Replay failed",
            message: `All ${MAX_REPLAY_RETRIES} retry attempts exhausted`,
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
            ? `Target destination timed out after ${MAX_REPLAY_RETRIES} attempts (${
                REPLAY_TIMEOUT_MS / 1000
              }s timeout per attempt)`
            : axiosError.message,
          code: axiosError.code,
        });
      }
    },
  );
