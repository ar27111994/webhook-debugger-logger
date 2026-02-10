/**
 * @file src/routes/logs.js
 * @description Logs route handlers for listing, fetching, and filtering webhook logs.
 * @module routes/logs
 */
import { asyncHandler, jsonSafe } from "./utils.js";
import { logRepository } from "../repositories/LogRepository.js";
import { parseRangeQuery, parseObjectFilter } from "../utils/filter_utils.js";
import { Actor } from "apify";
import { HTTP_STATUS } from "../consts/http.js";
import { SORT_DIRECTIONS } from "../consts/app.js";
import { DELIMITERS } from "../consts/network.js";
import { ERROR_LABELS, ERROR_MESSAGES } from "../consts/errors.js";
import { STORAGE_CONSTS } from "../consts/storage.js";
import { LOG_CONSTS } from "../consts/logging.js";
import {
  DEFAULT_SORT,
  PAGINATION_CONSTS,
  SQL_CONSTS,
} from "../consts/database.js";
import { HTTP_HEADERS } from "../consts/http.js";

/**
 * @typedef {import("../webhook_manager.js").WebhookManager} WebhookManager
 * @typedef {import("../typedefs.js").LogFilters} LogFilters
 * @typedef {import("../typedefs.js").SortRule} SortRule
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("../repositories/LogRepository.js").LogRepository} LogRepository
 */

/**
 * Creates the logs route handler.
 * @param {WebhookManager} _webhookManager
 * @param {object} [deps]
 * @param {LogRepository} [deps.logRepo] - Optional repository injection for testing
 * @returns {RequestHandler}
 */
export const createLogsHandler = (
  _webhookManager,
  { logRepo = logRepository } = {},
) =>
  asyncHandler(
    /** @param {Request} req @param {Response} res */
    async (req, res) => {
      try {
        let {
          id,
          webhookId,
          method,
          statusCode,
          contentType,
          startTime,
          endTime,
          signatureValid,
          requestId,
          remoteIp,
          userAgent,
          processingTime,
          size,
          headers,
          query,
          body,
          responseBody,
          responseHeaders,
          signatureProvider,
          signatureError,
          limit = PAGINATION_CONSTS.MAX_PAGE_LIMIT,
          offset = PAGINATION_CONSTS.DEFAULT_PAGE_OFFSET,
          cursor,
          sort = DEFAULT_SORT.join(DELIMITERS.QUERY_SORT),
          timestamp,
        } = req.query;

        // Parse pagination
        const limitNum = Math.max(
          parseInt(String(limit), 10) || PAGINATION_CONSTS.DEFAULT_PAGE_LIMIT,
          1,
        );
        const offsetNum = Math.max(
          parseInt(String(offset), 10) || PAGINATION_CONSTS.DEFAULT_PAGE_OFFSET,
          0,
        );

        // Parse timestamp filters (Legacy support + Range support)
        const timestampConditions = parseRangeQuery(timestamp, "string") || [];
        if (startTime) {
          timestampConditions.push({
            operator: SQL_CONSTS.OPERATORS.GTE,
            value: new Date(String(startTime)).toISOString(),
          });
        }
        if (endTime) {
          timestampConditions.push({
            operator: SQL_CONSTS.OPERATORS.LTE,
            value: new Date(String(endTime)).toISOString(),
          });
        }

        // Sorting
        const sortParam = sort ? String(sort) : "";
        /** @type {SortRule[]} */
        const sortRules = [];

        if (sortParam) {
          const parts = sortParam.split(DELIMITERS.QUERY_LIST);
          for (const part of parts) {
            const [field, dir] = part.split(DELIMITERS.QUERY_SORT);
            if (!field) continue;

            const sortDir =
              dir && dir.toUpperCase() === SORT_DIRECTIONS.ASC
                ? SORT_DIRECTIONS.ASC
                : SORT_DIRECTIONS.DESC;
            sortRules.push({
              field: field.trim(),
              dir: sortDir,
            });
          }
        } else {
          sortRules.push({
            field: LOG_CONSTS.VALID_SORT_FIELDS.includes(
              SQL_CONSTS.COLUMNS.TIMESTAMP,
            )
              ? SQL_CONSTS.COLUMNS.TIMESTAMP
              : LOG_CONSTS.VALID_SORT_FIELDS[0],
            dir: SORT_DIRECTIONS.DESC,
          });
        }

        // Parse other filters
        /** @type {LogFilters} */
        const filters = {
          limit: limitNum,
          offset: cursor ? undefined : offsetNum,
          cursor: cursor ? String(cursor) : undefined,
          sort: sortRules,
          id: id ? String(id) : undefined,
          webhookId: webhookId ? String(webhookId) : undefined,
          requestUrl: req.query.requestUrl
            ? String(req.query.requestUrl)
            : undefined,
          method: method ? String(method).toUpperCase() : undefined,
          contentType: contentType ? String(contentType) : undefined,
          requestId: requestId ? String(requestId) : undefined,
          remoteIp: typeof remoteIp === "string" ? remoteIp : undefined,
          userAgent: userAgent ? String(userAgent) : undefined,
          signatureValid:
            signatureValid !== undefined
              ? String(signatureValid) === String(true)
              : undefined,
          signatureProvider: signatureProvider
            ? String(signatureProvider)
            : undefined,
          signatureError: signatureError ? String(signatureError) : undefined,
          // StatusCode can be a range (e.g. gt:400) or exact value
          statusCode: parseRangeQuery(statusCode),
          processingTime: parseRangeQuery(processingTime),
          size: parseRangeQuery(size),
          timestamp:
            timestampConditions.length > 0 ? timestampConditions : undefined,
          headers: parseObjectFilter(headers) || undefined,
          query: parseObjectFilter(query) || undefined,
          body: parseObjectFilter(body) || undefined,
          responseHeaders: parseObjectFilter(responseHeaders) || undefined,
          responseBody: parseObjectFilter(responseBody) || undefined,
        };

        // Transform items (add detailUrl)
        const baseUrl = `${req.protocol}://${req.get("host")}${req.baseUrl}`;

        // Cursor-based pagination (more efficient for large datasets)
        if (cursor) {
          const { items, nextCursor } = await logRepo.findLogsCursor(filters);

          const enrichedItems = items.map((item) => ({
            ...item,
            detailUrl: `${baseUrl}/${item.id}`,
          }));

          let nextPageUrl = null;
          if (nextCursor) {
            const nextParams = new URLSearchParams(
              /** @type {Record<string, any>} */ (req.query),
            );
            nextParams.set("cursor", nextCursor);
            nextParams.delete("offset");
            nextPageUrl = `${baseUrl}?${nextParams.toString()}`;
          }

          res.json(
            jsonSafe({
              filters,
              count: enrichedItems.length,
              items: enrichedItems,
              nextCursor,
              nextPageUrl,
            }),
          );
          return;
        }

        // Offset-based pagination (traditional)
        const { items, total } = await logRepo.findLogs(filters);

        const enrichedItems = items.map((item) => ({
          ...item,
          detailUrl: `${baseUrl}/${item.id}`,
        }));

        // Pagination Metadata
        let nextOffset = null;
        if (offsetNum + items.length < total) {
          nextOffset = offsetNum + limitNum;
        }

        let nextPageUrl = null;
        if (nextOffset !== null) {
          const nextParams = new URLSearchParams(
            /** @type {Record<string, any>} */ (req.query),
          );
          nextParams.set("offset", String(nextOffset));
          nextPageUrl = `${baseUrl}?${nextParams.toString()}`;
        }

        res.json(
          jsonSafe({
            filters, // Return understood filters
            count: enrichedItems.length,
            total,
            items: enrichedItems,
            nextOffset,
            nextPageUrl,
          }),
        );
      } catch (_e) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: ERROR_LABELS.LOGS_FAILED,
          message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        });
      }
    },
  );

/**
 * Creates the log detail route handler.
 * @param {WebhookManager} webhookManager
 * @returns {RequestHandler}
 */
export const createLogDetailHandler = (webhookManager) =>
  asyncHandler(
    /**
     * @param {Request} req
     * @param {Response} res
     */
    async (req, res) => {
      try {
        /** @type {{logId?: string}} */
        const { logId = "" } = req.params;
        /** @type {{fields?: string}} */
        const { fields } = req.query;

        const fieldList = fields
          ? String(fields)
              .split(",")
              .map((f) => f.trim())
              .filter(Boolean)
          : [];

        // Always include webhookId for security validation, even if not requested
        const effectiveFields =
          fieldList.length > 0 ? [...new Set([...fieldList, "webhookId"])] : [];

        const validatedItem = await logRepository.getLogById(
          logId,
          effectiveFields,
        );

        if (!validatedItem) {
          res
            .status(HTTP_STATUS.NOT_FOUND)
            .json({ error: ERROR_MESSAGES.LOG_NOT_FOUND });
          return;
        }

        if (!webhookManager.isValid(validatedItem.webhookId)) {
          res
            .status(HTTP_STATUS.NOT_FOUND)
            .json({ error: ERROR_MESSAGES.INVALID_WEBHOOK_LOG });
          return;
        }

        // Remove webhookId if it wasn't originally requested but we fetched it for security
        if (fieldList.length > 0 && !fieldList.includes("webhookId")) {
          // Destructure to remove webhookId without deleting required property from type
          const { webhookId: _unused, ...safeItem } = validatedItem;
          res.json(safeItem);
          return;
        }

        res.json(validatedItem);
      } catch (_e) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: ERROR_MESSAGES.LOG_DETAIL_FAILED,
          message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        });
      }
    },
  );

/**
 * Creates the log payload proxy handler.
 * Fetches the full payload from KVS if offloaded, or returns the stored body.
 * @param {WebhookManager} webhookManager
 * @returns {RequestHandler}
 */
export const createLogPayloadHandler = (webhookManager) =>
  asyncHandler(
    /** @param {Request} req @param {Response} res */
    async (req, res) => {
      try {
        const { logId = "" } = req.params;
        const item = await logRepository.getLogById(String(logId));

        if (!item) {
          res
            .status(HTTP_STATUS.NOT_FOUND)
            .json({ error: ERROR_MESSAGES.LOG_NOT_FOUND });
          return;
        }

        if (!webhookManager.isValid(item.webhookId)) {
          res
            .status(HTTP_STATUS.NOT_FOUND)
            .json({ error: ERROR_MESSAGES.INVALID_WEBHOOK_LOG });
          return;
        }

        /** @type {any} */
        let bodyToSend = item.body;
        let isOffloaded = false;
        let kvsKey = null;

        // Check if offloaded
        if (
          bodyToSend &&
          typeof bodyToSend === "object" &&
          [
            STORAGE_CONSTS.OFFLOAD_MARKER_SYNC,
            STORAGE_CONSTS.OFFLOAD_MARKER_STREAM,
          ].includes(bodyToSend.data) &&
          bodyToSend.key
        ) {
          isOffloaded = true;
          kvsKey = bodyToSend.key;
        }

        if (isOffloaded && kvsKey) {
          // Stream from KVS
          const store = await Actor.openKeyValueStore();
          const value = await store.getValue(kvsKey);

          if (!value) {
            res
              .status(HTTP_STATUS.NOT_FOUND)
              .json({ error: ERROR_MESSAGES.PAYLOAD_NOT_FOUND_KVS });
            return;
          }

          if (item.contentType) {
            res.setHeader(HTTP_HEADERS.CONTENT_TYPE, item.contentType);
          }

          if (Buffer.isBuffer(value)) {
            res.send(value);
          } else if (typeof value === "object") {
            res.json(value);
          } else {
            res.send(String(value));
          }
        } else {
          // Return stored body directly
          if (item.contentType) {
            res.setHeader(HTTP_HEADERS.CONTENT_TYPE, item.contentType);
          }
          if (typeof bodyToSend === "object") {
            res.json(bodyToSend);
          } else {
            res.send(bodyToSend);
          }
        }
      } catch (_e) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: ERROR_MESSAGES.PAYLOAD_FETCH_FAILED,
          message: ERROR_LABELS.INTERNAL_SERVER_ERROR,
        });
      }
    },
  );
