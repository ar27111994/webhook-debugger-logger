/**
 * Logs route handler module.
 * @module routes/logs
 */
import { asyncHandler, jsonSafe } from "./utils.js";
import { logRepository } from "../repositories/LogRepository.js";
import { parseRangeQuery, parseObjectFilter } from "../utils/filter_utils.js";
import {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
  MAX_PAGE_LIMIT,
} from "../consts.js";

/**
 * @typedef {import("../webhook_manager.js").WebhookManager} WebhookManager
 * @typedef {import("../typedefs.js").LogFilters} LogFilters
 * @typedef {import("../typedefs.js").SortRule} SortRule
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 */

/**
 * Creates the logs route handler.
 * @param {WebhookManager} _webhookManager
 * @returns {RequestHandler}
 */
export const createLogsHandler = (_webhookManager) =>
  asyncHandler(
    /** @param {Request} req @param {Response} res */
    async (req, res) => {
      try {
        const DEFAULT_SORT = ["timestamp", "desc"];

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
          limit = MAX_PAGE_LIMIT,
          offset = DEFAULT_PAGE_OFFSET,
          sort = DEFAULT_SORT.join(":"),
          timestamp,
        } = req.query;

        // Parse pagination
        const limitNum = Math.max(
          parseInt(String(limit), 10) || DEFAULT_PAGE_LIMIT,
          1,
        );
        const offsetNum = Math.max(
          parseInt(String(offset), 10) || DEFAULT_PAGE_OFFSET,
          0,
        );

        // Parse timestamp filters (Legacy support + Range support)
        const timestampConditions = parseRangeQuery(timestamp, "string") || [];
        if (startTime) {
          timestampConditions.push({
            operator: "gte",
            value: new Date(String(startTime)).toISOString(),
          });
        }
        if (endTime) {
          timestampConditions.push({
            operator: "lte",
            value: new Date(String(endTime)).toISOString(),
          });
        }

        // Sorting
        const sortParam = sort ? String(sort) : "";
        /** @type {SortRule[]} */
        const sortRules = [];

        if (sortParam) {
          const parts = sortParam.split(",");
          for (const part of parts) {
            const [field, dir] = part.split(":");
            sortRules.push({
              field: field.trim(),
              dir: (dir || "desc").toLowerCase() === "asc" ? "asc" : "desc",
            });
          }
        } else {
          sortRules.push({ field: "timestamp", dir: "desc" });
        }

        // Parse other filters
        /** @type {LogFilters} */
        const filters = {
          limit: limitNum,
          offset: offsetNum,
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
              ? String(signatureValid) === "true"
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

        // Execute Query
        const { items, total } = await logRepository.findLogs(filters);

        // Transform items (add detailUrl)
        const baseUrl = `${req.protocol}://${req.get("host")}${req.baseUrl}`;
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
      } catch (e) {
        res.status(500).json({
          error: "Logs failed",
          message: /** @type {Error} */ (e).message,
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
  /**
   * @param {Request} req
   * @param {Response} res
   */
  asyncHandler(async (req, res) => {
    try {
      /** @type {{logId?: string}} */
      const { logId = "" } = req.params;

      const foundItem = await logRepository.getLogById(logId);

      if (!foundItem) {
        res.status(404).json({ error: "Log entry not found" });
        return;
      }

      // Security Check: Ensure webhook ID is still valid for this user context
      if (!webhookManager.isValid(foundItem.webhookId)) {
        res.status(404).json({ error: "Log entry belongs to invalid webhook" });
        return;
      }

      res.json(foundItem);
    } catch (e) {
      res.status(500).json({
        error: "Failed to fetch log detail",
        message: /** @type {Error} */ (e).message,
      });
    }
  });
