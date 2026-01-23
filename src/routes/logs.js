/**
 * Logs route handler module.
 * @module routes/logs
 */
import { Actor } from "apify";
import { asyncHandler } from "./utils.js";
import { MAX_ITEMS_FOR_BATCH } from "../consts.js";

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("express").RequestHandler} RequestHandler
 * @typedef {import("../webhook_manager.js").WebhookManager} WebhookManager
 */

// Fields to fetch from the dataset
const LOG_FIELDS = Object.freeze([
  "id",
  "webhookId",
  "timestamp",
  "method",
  "statusCode",
  "headers",
  "signatureValid",
  "requestId",
  "remoteIp",
  "userAgent",
  "contentType",
  "processingTime",
]);

/**
 * Creates the logs route handler.
 * @param {WebhookManager} webhookManager
 * @returns {RequestHandler}
 */
export const createLogsHandler = (webhookManager) =>
  asyncHandler(
    /** @param {Request} req @param {Response} res */
    async (req, res) => {
      try {
        const CHUNK_SIZE = MAX_ITEMS_FOR_BATCH;
        let {
          webhookId,
          method,
          statusCode,
          contentType,
          startTime,
          endTime,
          signatureValid,
          requestId,
          limit = 100,
          offset = 0,
        } = req.query;
        limit = Math.min(
          Math.max(parseInt(String(limit), 10) || 100, 1),
          CHUNK_SIZE,
        );
        offset = Math.max(parseInt(String(offset), 10) || 0, 0);

        // Parse timestamp filters
        const startDate = startTime ? new Date(String(startTime)) : null;
        const endDate = endTime ? new Date(String(endTime)) : null;
        const sigValid =
          signatureValid === "true"
            ? true
            : signatureValid === "false"
              ? false
              : undefined;

        const dataset = await Actor.openDataset();
        const datasetInfo = await dataset.getInfo();
        const totalItems = datasetInfo?.itemCount || 0;

        /** @type {any[]} */
        let itemsBuffer = [];
        let currentOffset = offset;
        let hasMore = true;

        // Fetch in chunks until we have enough items or exhaust the dataset
        while (itemsBuffer.length < limit && hasMore) {
          const { items } = await dataset.getData({
            limit: CHUNK_SIZE,
            offset: currentOffset,
            desc: true,
            // Optimization: Only fetch metadata fields
            fields: /** @type {string[]} */ (LOG_FIELDS),
          });

          if (items.length === 0) {
            hasMore = false;
            break;
          }

          // Add raw index tracking to items
          /** @type {any[]} */
          const itemsWithIndex = items.map((item, index) => ({
            ...item,
            _index: currentOffset + index,
          }));

          // Apply filters to current chunk
          const batchMatches = itemsWithIndex.filter((item) => {
            if (webhookId && item.webhookId !== webhookId) return false;
            if (
              method &&
              item.method?.toUpperCase() !== String(method).toUpperCase()
            )
              return false;
            if (statusCode && String(item.statusCode) !== String(statusCode))
              return false;
            if (
              contentType &&
              !item.headers?.["content-type"]?.includes(String(contentType))
            )
              return false;
            // Timestamp range filter
            if (startDate && !isNaN(startDate.getTime())) {
              const itemDate = new Date(item.timestamp);
              if (itemDate < startDate) return false;
            }
            if (endDate && !isNaN(endDate.getTime())) {
              const itemDate = new Date(item.timestamp);
              if (itemDate > endDate) return false;
            }
            // Signature status filter
            if (sigValid !== undefined && item.signatureValid !== sigValid)
              return false;
            // Request ID filter
            if (requestId && item.requestId !== requestId) return false;

            // Security Filters
            if (
              req.query.remoteIp &&
              item.remoteIp !== String(req.query.remoteIp)
            )
              return false;
            if (
              req.query.userAgent &&
              item.userAgent !== String(req.query.userAgent)
            )
              return false;

            return webhookManager.isValid(item.webhookId);
          });

          itemsBuffer = itemsBuffer.concat(batchMatches);
          currentOffset += CHUNK_SIZE; // Advance offset by strictly the chunk size (raw dataset positions)

          // Optimization: If we fetched less than CHUNK_SIZE, we are at the end
          if (items.length < CHUNK_SIZE) {
            hasMore = false;
          }
        }

        // Sorting Logic
        const sortParam = req.query.sort ? String(req.query.sort) : "";

        // Whitelist allowed sort fields
        const allowedSortFields = LOG_FIELDS.filter(
          (field) => field !== "headers",
        ); // Exclude headers objects from sorting

        // Parse sort criteria: "field1:dir1,field2:dir2"
        const sortCriteria = sortParam
          .split(",")
          .map((part) => {
            let [field, dir] = part.trim().split(":");
            field = field?.trim();
            dir = (dir || "desc").toLowerCase();
            return { field, dir };
          })
          .filter(
            (c) =>
              c.field &&
              allowedSortFields.includes(/** @type {any} */ (c.field)),
          );

        // Default to timestamp:desc if no valid criteria provided
        if (sortCriteria.length === 0) {
          sortCriteria.push({ field: "timestamp", dir: "desc" });
        }

        const filtered = itemsBuffer.sort((a, b) => {
          for (const { field, dir } of sortCriteria) {
            let valA = a[field];
            let valB = b[field];

            // Handle timestamp specifically (convert to Date for comparison)
            if (field === "timestamp") {
              valA = new Date(valA).getTime();
              valB = new Date(valB).getTime();
            }

            if (valA < valB) return dir === "asc" ? -1 : 1;
            if (valA > valB) return dir === "asc" ? 1 : -1;
          }
          return 0;
        });

        // Add detailUrl to items and remove internal _index
        const baseUrl = `${req.protocol}://${req.get("host")}${req.baseUrl}`;
        const enrichedItems = filtered.slice(0, limit).map((item) => {
          const { _index, ...rest } = item;
          return {
            ...rest,
            detailUrl: `${baseUrl}/${item.id}`,
          };
        });

        // Calculate nextOffset based on the last item's raw index
        let nextOffset = null;
        if (enrichedItems.length > 0) {
          const lastItem = filtered[enrichedItems.length - 1];
          nextOffset = lastItem._index + 1;

          // If we exhausted the dataset AND there are no more matches in memory,
          // then there is effectively no next page.
          if (!hasMore && filtered.length <= limit) {
            nextOffset = null;
          }
        } else if (hasMore) {
          // If we found no matches but dataset has more, continue from the next chunk.
          nextOffset = currentOffset;
        }

        let nextPageUrl = null;
        if (nextOffset !== null) {
          const nextParams = new URLSearchParams(
            /** @type {any} */ (req.query),
          );
          nextParams.set("offset", String(nextOffset));
          nextPageUrl = `${baseUrl}?${nextParams.toString()}`;
        }

        res.json({
          filters: {
            webhookId,
            method,
            statusCode,
            contentType,
            startTime,
            endTime,
            signatureValid,
            requestId,
            remoteIp: req.query.remoteIp,
            userAgent: req.query.userAgent,
          },
          count: enrichedItems.length,
          total: totalItems,
          items: enrichedItems,
          nextOffset,
          nextPageUrl,
        });
        return;
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
  asyncHandler(async (req, res) => {
    try {
      const { logId } = req.params;
      const dataset = await Actor.openDataset();

      // Scan for the item by ID.
      // Since we don't know the offset, we have to scan.
      // Optimization: We could take an optional 'timestamp' query param to narrow the search range if needed in future.
      const CHUNK_SIZE = MAX_ITEMS_FOR_BATCH;
      let offset = 0;
      let foundItem = null;

      // Simple linear scan (most recent first)
      // Limitation: Slow for very deep history, but acceptable for detail view of recent items.
      while (!foundItem) {
        const { items } = await dataset.getData({
          offset,
          limit: CHUNK_SIZE,
          desc: true,
        });

        if (items.length === 0) break;

        foundItem = items.find((item) => item.id === logId);
        if (foundItem) break;

        if (items.length < CHUNK_SIZE) break;
        offset += CHUNK_SIZE;
      }

      if (!foundItem) {
        res.status(404).json({ error: "Log entry not found" });
        return;
      }

      // Security Check: Ensure webhook ID is still valid for this user context
      // (Though currently single-tenant, good practice)
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
