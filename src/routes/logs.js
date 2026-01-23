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
          headers,
          limit = 100,
          offset = 0,
          sort = "timestamp:desc",
        } = req.query;
        limit = Math.min(
          Math.max(parseInt(String(limit), 10) || 100, 1),
          CHUNK_SIZE,
        );
        offset = Math.max(parseInt(String(offset), 10) || 0, 0);

        // Parse timestamp filters
        // Pre-process filters outside the loop for performance
        const startDate = startTime ? new Date(String(startTime)) : null;
        const endDate = endTime ? new Date(String(endTime)) : null;
        const sigValid =
          signatureValid === "true"
            ? true
            : signatureValid === "false"
              ? false
              : undefined;
        const filterWebhookId = webhookId ? String(webhookId) : null;
        const filterMethod = method ? String(method).toUpperCase() : null;
        const filterStatus = statusCode ? Number(statusCode) : null;
        const filterType = contentType
          ? String(contentType).toLowerCase()
          : null;
        const filterRequestId = requestId ? String(requestId) : null;
        const filterIp = remoteIp ? String(remoteIp) : null;
        const filterUa = userAgent ? String(userAgent) : null;

        const filterId = id ? String(id) : null;
        const filterProcessingTime = processingTime
          ? Number(processingTime)
          : null;

        // Handle headers filter (string or object)
        /** @type {Record<string, string> | string | null} */
        let filterHeaders = null;
        if (headers) {
          if (typeof headers === "string") {
            filterHeaders = headers.toLowerCase();
          } else if (typeof headers === "object") {
            /** @type {Record<string, string>} */
            const headerObj = {};
            for (const [k, v] of Object.entries(headers)) {
              headerObj[k.toLowerCase()] = String(v).toLowerCase();
            }
            filterHeaders = headerObj;
          }
        }

        // ISO String comparison is faster than new Date() per item
        // (Assumes item.timestamp is always ISO 8601 from new Date().toISOString())
        const filterStart =
          startDate && !isNaN(startDate.getTime())
            ? startDate.toISOString()
            : null;
        const filterEnd =
          endDate && !isNaN(endDate.getTime()) ? endDate.toISOString() : null;

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
            // 1. Webhook Validity (Security) - Checking first prevents leaking info about invalid/expired webhooks
            if (!webhookManager.isValid(item.webhookId)) return false;

            // 2. Exact Match Filters
            if (filterId && item.id !== filterId) return false; // Added
            if (filterWebhookId && item.webhookId !== filterWebhookId)
              return false;
            if (filterRequestId && item.requestId !== filterRequestId)
              return false;

            // Numeric Checks
            if (filterStatus !== null && item.statusCode !== filterStatus)
              return false;
            if (
              filterProcessingTime !== null &&
              item.processingTime !== filterProcessingTime
            )
              return false;

            // Checking method case-insensitively (assuming standard data, but safe)
            if (filterMethod && item.method?.toUpperCase() !== filterMethod)
              return false;
            if (sigValid !== undefined && item.signatureValid !== sigValid)
              return false;

            // 3. String Match Filters
            if (filterIp && item.remoteIp !== filterIp) return false;
            if (filterUa && item.userAgent !== filterUa) return false;

            // 4. Content Type (Substring match on specialized field)
            if (
              filterType &&
              !item.contentType?.toLowerCase().includes(filterType)
            ) {
              return false;
            }

            // 5. Headers Filter
            if (filterHeaders) {
              const itemHeaders = item.headers || {};
              if (typeof filterHeaders === "string") {
                // Search entire headers object as string
                if (
                  !JSON.stringify(itemHeaders)
                    .toLowerCase()
                    .includes(filterHeaders)
                )
                  return false;
              } else {
                // Object match: All provided keys must substring-match
                for (const [key, searchVal] of Object.entries(filterHeaders)) {
                  const itemVal = itemHeaders[key];
                  if (
                    !itemVal ||
                    !String(itemVal).toLowerCase().includes(searchVal)
                  )
                    return false;
                }
              }
            }

            // 5. Timestamp Range (String comparison)
            if (filterStart && item.timestamp < filterStart) return false;
            if (filterEnd && item.timestamp > filterEnd) return false;

            return true;
          });

          itemsBuffer = itemsBuffer.concat(batchMatches);
          currentOffset += CHUNK_SIZE; // Advance offset by strictly the chunk size (raw dataset positions)

          // Optimization: If we fetched less than CHUNK_SIZE, we are at the end
          if (items.length < CHUNK_SIZE) {
            hasMore = false;
          }
        }

        // Sorting Logic
        const sortParam = sort ? String(sort) : "";

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
          .filter((c) => c.field && allowedSortFields.includes(c.field));

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
