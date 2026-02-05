/**
 * @file src/repositories/LogRepository.js
 * @description Data access layer for Logs (Read Model)
 */

import {
  executeQuery,
  executeWrite,
  executeTransaction,
} from "../db/duckdb.js";
import { parseIfPresent } from "../utils/common.js";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
  SQL_FRAGMENTS,
  SORT_DIRECTIONS,
} from "../consts.js";
import {
  OFFLOAD_MARKER_SYNC,
  OFFLOAD_MARKER_STREAM,
} from "../utils/storage_helper.js";

/**
 * @typedef {import('@duckdb/node-api').DuckDBValue} DuckDBValue
 * @typedef {import('../utils/filter_utils.js').RangeCondition} RangeCondition
 * @typedef {import('../typedefs.js').WebhookEvent} WebhookEvent
 * @typedef {import('../typedefs.js').LogEntry} LogEntry
 * @typedef {import('../typedefs.js').SortRule} SortRule
 * @typedef {import('../typedefs.js').LogFilters} LogFilters
 */

/**
 * @typedef {Object} Clauses
 * @property {string[]} conditions
 * @property {Record<string, DuckDBValue>} params
 */

/**
 * @typedef {Object} SQLQuery
 * @property {string} sql
 * @property {Clauses['params']} params
 */

const INSERT_LOG_SQL = `
    INSERT INTO logs (
        id, webhookId, timestamp, method, statusCode, size, remoteIp, userAgent, requestUrl,
        headers, query, body, responseHeaders, responseBody,
        signatureValid, signatureProvider, signatureError,
        requestId, processingTime, contentType,
        source_offset, bodyEncoding
    ) VALUES (
        $id, $webhookId, $timestamp, $method, $statusCode, $size, $remoteIp, $userAgent, $requestUrl,
        $headers, $query, $body, $responseHeaders, $responseBody,
        $signatureValid, $signatureProvider, $signatureError,
        $requestId, $processingTime, $contentType,
        $sourceOffset, $bodyEncoding
    )
    ON CONFLICT (id) DO UPDATE SET
        source_offset = COALESCE(EXCLUDED.source_offset, logs.source_offset)
`;

const VALID_LOG_COLUMNS = Object.freeze([
  "id",
  "webhookId",
  "timestamp",
  "method",
  "statusCode",
  "size",
  "remoteIp",
  "userAgent",
  "requestUrl",
  "headers",
  "query",
  "body",
  "responseHeaders",
  "responseBody",
  "signatureValid",
  "signatureProvider",
  "signatureError",
  "requestId",
  "processingTime",
  "contentType",
  "source_offset",
  "bodyEncoding",
]);

export class LogRepository {
  /**
   * Validates sort fields
   * @param {SortRule[]} sortRules
   * @returns {string} - SQL ORDER BY clause
   */
  #buildOrderBy(sortRules) {
    /** @type {Record<string, string>} */
    const validSorts = {
      id: "id",
      statusCode: "statusCode",
      method: "method",
      size: "size",
      timestamp: "timestamp",
      remoteIp: "remoteIp",
      processingTime: "processingTime",
      webhookId: "webhookId",
      userAgent: "userAgent",
      requestUrl: "requestUrl",
      contentType: "contentType",
      requestId: "requestId",
      signatureValid: "signatureValid",
      signatureProvider: "signatureProvider",
      signatureError: "signatureError",
    };
    const defaultClause = `timestamp ${SORT_DIRECTIONS.DESC}`;

    if (!sortRules || sortRules.length === 0) {
      return defaultClause;
    }

    const clauses = sortRules
      .map((rule) => {
        const col = validSorts[rule.field];
        if (!col) return null;
        const dir =
          rule.dir.toUpperCase() === SORT_DIRECTIONS.ASC
            ? SORT_DIRECTIONS.ASC
            : SORT_DIRECTIONS.DESC;
        return `${col} ${dir}`;
      })
      .filter(Boolean);

    return clauses.length > 0 ? clauses.join(", ") : defaultClause;
  }

  /**
   * Adds range conditions to the WHERE clause
   * @param {string} col
   * @param {RangeCondition[] | undefined} conds
   * @returns {Clauses}
   */
  #addRange(col, conds) {
    /** @type {Clauses} */
    const result = { conditions: [], params: {} };
    if (!conds || !Array.isArray(conds)) return result;

    conds.forEach((cond, idx) => {
      const pName = `${col}_${idx}`;
      /** @type {Record<string, string>} */
      const opMap = {
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
        eq: "=",
        ne: "!=",
      };
      const sqlOp = opMap[cond.operator];
      if (sqlOp) {
        result.conditions.push(`${col} ${sqlOp} $${pName}`);
        result.params[pName] =
          col === "timestamp"
            ? new Date(cond.value).toISOString()
            : Number(cond.value);
      }
    });

    return result;
  }

  /**
   * Adds JSON filter conditions to the WHERE clause
   * @param {string} col
   * @param {Object|string|undefined} filter
   * @returns {Clauses}
   */
  #addJsonFilter(col, filter) {
    /** @type {Clauses} */
    const result = { conditions: [], params: {} };
    if (!filter) return result;

    if (typeof filter === "string") {
      const pName = `${col}_json_search`;
      result.conditions.push(
        `json_extract_string(${col}, '$') ILIKE $${pName}`,
      );
      result.params[pName] = `%${filter}%`;
    } else {
      Object.entries(filter).forEach(([key, val], idx) => {
        const pName = `${col}_key_${idx}`;
        result.conditions.push(
          `json_extract_string(${col}, '$.${key}') ILIKE $${pName}`,
        );
        result.params[pName] = `%${val}%`;
      });
    }

    return result;
  }

  /**
   * Builds the WHERE clause for DuckDB
   * @param {LogFilters} conditions
   * @returns {SQLQuery}
   */
  #buildWhereClause(conditions) {
    /** @type {Clauses['params']} */
    let params = {};
    /** @type {string[]} */
    const where = [SQL_FRAGMENTS.TRUE_CONDITION];

    /**
     * Helper to merge partial results
     * @param {Clauses} partial
     */
    const merge = (partial) => {
      if (partial.conditions.length > 0) where.push(...partial.conditions);
      Object.assign(params, partial.params);
    };

    if (conditions.search) {
      where.push("(id ILIKE $search OR requestUrl ILIKE $search)");
      params.search = `%${conditions.search}%`;
    }

    if (conditions.requestUrl) {
      where.push("requestUrl ILIKE $requestUrl");
      params.requestUrl = `%${conditions.requestUrl}%`;
    }

    if (conditions.method) {
      where.push("method = $method");
      params.method = conditions.method;
    }

    if (conditions.statusCode) {
      if (Array.isArray(conditions.statusCode)) {
        merge(this.#addRange("statusCode", conditions.statusCode));
      } else {
        where.push("statusCode = $statusCode");
        params.statusCode = Number(conditions.statusCode);
      }
    }

    if (conditions.webhookId) {
      where.push("webhookId = $webhookId");
      params.webhookId = conditions.webhookId;
    }

    if (conditions.requestId) {
      where.push("requestId = $requestId");
      params.requestId = conditions.requestId;
    }

    if (conditions.remoteIp) {
      if (conditions.remoteIp.includes("/")) {
        // CIDR search
        where.push("CAST(remoteIp AS INET) <<= CAST($remoteIp AS INET)");
        params.remoteIp = conditions.remoteIp;
      } else {
        where.push("remoteIp = $remoteIp");
        params.remoteIp = conditions.remoteIp;
      }
    }

    if (conditions.userAgent) {
      where.push("userAgent ILIKE $userAgent");
      params.userAgent = `%${conditions.userAgent}%`;
    }

    if (conditions.contentType) {
      where.push("contentType ILIKE $contentType");
      params.contentType = `%${conditions.contentType}%`;
    }

    if (conditions.signatureValid !== undefined) {
      where.push("signatureValid = $signatureValid");
      params.signatureValid = String(conditions.signatureValid) === "true";
    }

    if (conditions.signatureProvider) {
      where.push("signatureProvider = $signatureProvider");
      params.signatureProvider = conditions.signatureProvider;
    }

    if (conditions.signatureError) {
      where.push("signatureError ILIKE $signatureError");
      params.signatureError = `%${conditions.signatureError}%`;
    }

    merge(this.#addRange("size", conditions.size));
    merge(this.#addRange("timestamp", conditions.timestamp));
    merge(this.#addRange("processingTime", conditions.processingTime));

    merge(this.#addJsonFilter("headers", conditions.headers));
    merge(this.#addJsonFilter("query", conditions.query));
    merge(this.#addJsonFilter("body", conditions.body));
    merge(this.#addJsonFilter("responseHeaders", conditions.responseHeaders));
    merge(this.#addJsonFilter("responseBody", conditions.responseBody));

    return { sql: where.join(" AND "), params };
  }

  /**
   * Helper to convert BigInts to Numbers for JSON serialization
   * @param {Record<string, DuckDBValue>} row
   * @returns {Record<string, DuckDBValue>}
   */
  #fixBigInts(row) {
    if (!row) return row;

    const newRow = { ...row };
    for (const key in newRow) {
      if (typeof newRow[key] === "bigint") {
        newRow[key] = Number(newRow[key]);
      }
    }
    return newRow;
  }

  /**
   * Find logs with filters
   * @param {LogFilters} filters
   * @returns {Promise<{ items: Array<WebhookEvent>, total: number }>}
   */
  async findLogs(filters) {
    const { sql: whereSql, params } = this.#buildWhereClause(filters);

    // Count
    const countSql = `SELECT COUNT(*) as total FROM logs WHERE ${whereSql}`;
    const countRows = await executeQuery(countSql, params);
    const total = Number(countRows[0]?.total || 0);

    // Sort & Page
    const orderByClause = this.#buildOrderBy(filters.sort || []);
    const limit = Math.min(
      Number(filters.limit) || DEFAULT_PAGE_LIMIT,
      MAX_PAGE_LIMIT,
    );
    const offset = Number(filters.offset) || DEFAULT_PAGE_OFFSET;

    params.limit = limit;
    params.offset = offset;

    const sql = `
    SELECT * FROM logs
    WHERE ${whereSql}
    ORDER BY ${orderByClause}
    LIMIT $limit OFFSET $offset
  `;

    const rows = await executeQuery(sql, params);

    const items = rows.map((rawRow) => {
      const row = this.#fixBigInts(rawRow);
      const entry = /** @type {LogEntry} */ ({
        ...row,
        headers: parseIfPresent("headers", row),
        query: parseIfPresent("query", row),
        body: parseIfPresent("body", row),
        responseHeaders: parseIfPresent("responseHeaders", row),
        responseBody: parseIfPresent("responseBody", row),
        signatureValid: row.signatureValid === true || row.signatureValid === 1,
      });

      // Strip undefined keys
      Object.keys(entry).forEach((k) => {
        const key = /** @type {keyof LogEntry} */ (k);
        if (entry[key] === undefined) delete entry[key];
      });

      return entry;
    });

    return { items, total };
  }

  /**
   * Get single log by ID
   * @param {string} id
   * @param {string[]} [fields=[]] - Optional list of fields to fetch. Defaults to all.
   * @returns {Promise<LogEntry | null>}
   */
  async getLogById(id, fields = []) {
    // Validate and whitelist fields
    const selectedFields =
      fields && fields.length > 0
        ? fields.filter((f) => VALID_LOG_COLUMNS.includes(f))
        : [];

    // Ensure we select what we asked for, or default to all
    const finalSelect =
      selectedFields.length > 0 ? selectedFields.join(", ") : "*";

    const sql = `SELECT ${finalSelect} FROM logs WHERE id = $id`;
    const rows = await executeQuery(sql, { id });
    if (rows.length === 0) return null;

    const rawRow = rows[0];
    const row = this.#fixBigInts(rawRow);

    return /** @type {LogEntry} */ ({
      ...row,
      headers: parseIfPresent("headers", row),
      query: parseIfPresent("query", row),
      body: parseIfPresent("body", row),
      responseHeaders: parseIfPresent("responseHeaders", row),
      responseBody: parseIfPresent("responseBody", row),
    });
  }

  /**
   * Map a log entry to database parameters
   * @param {LogEntry} log
   * @returns {Record<string, DuckDBValue>}
   */
  #mapLogToParams(log) {
    return {
      id: log.id,
      webhookId: log.webhookId || null,
      timestamp:
        typeof log.timestamp === "string"
          ? log.timestamp
          : new Date(log.timestamp).toISOString(),
      method: log.method || null,
      statusCode: log.statusCode || null,
      size: log.size || 0,
      remoteIp: log.remoteIp || null,
      userAgent: log.userAgent || null,
      requestUrl: log.url || log.requestUrl || null,
      headers: JSON.stringify(log.headers || {}),
      query: JSON.stringify(log.query || {}),
      body: JSON.stringify(log.body || {}),
      responseHeaders: JSON.stringify(log.responseHeaders || {}),
      responseBody: JSON.stringify(log.responseBody || {}),

      signatureValid:
        log.signatureValidation?.valid || log.signatureValid || false,
      signatureProvider:
        log.signatureValidation?.provider || log.signatureProvider || null,
      signatureError:
        log.signatureValidation?.error || log.signatureError || null,

      requestId: log.requestId || null,
      processingTime: log.processingTime || null,
      contentType: log.contentType || null,
      bodyEncoding: log.bodyEncoding || null,

      sourceOffset: log.sourceOffset !== undefined ? log.sourceOffset : null,
    };
  }

  /**
   * Insert or update a single log entry.
   * Uses ON CONFLICT to update source_offset if a record already exists.
   * @param {LogEntry} log
   * @returns {Promise<void>}
   */
  async insertLog(log) {
    await executeWrite(INSERT_LOG_SQL, this.#mapLogToParams(log));
  }

  /**
   * Batch insert multiple logs in a single transaction
   * @param {Array<LogEntry>} logs
   * @returns {Promise<void>}
   */
  async batchInsertLogs(logs) {
    if (!logs.length) return;

    await executeTransaction(async (conn) => {
      for (const log of logs) {
        // conn.run is used directly inside transaction task
        // We need to map params correctly.
        // NOTE: executeTransaction gives us a connection.
        // We can't use executeQuery here because it acquires a NEW connection.
        // We must use the transaction connection.
        await conn.run(INSERT_LOG_SQL, this.#mapLogToParams(log));
      }
    });
  }

  /**
   * Find all offloaded payloads for a specific webhook.
   * Dictionary-encoded string searching in DuckDB is fast, but JSON extraction is safer.
   * @param {string} webhookId
   * @returns {Promise<Array<{ key: string }>>}
   */
  async findOffloadedPayloads(webhookId) {
    // We only select the body.
    // We filter where body.data is one of our markers.
    // Note: body is stored as JSON text in our schema, but inserted as JSON.
    // DuckDB `json_extract_string` works on JSON strings.

    const sql = `
      SELECT body
      FROM logs
      WHERE webhookId = $webhookId
      AND (
        json_extract_string(body, '$.data') = $markerSync
        OR
        json_extract_string(body, '$.data') = $markerStream
      )
    `;

    const rows = await executeQuery(sql, {
      webhookId,
      markerSync: OFFLOAD_MARKER_SYNC,
      markerStream: OFFLOAD_MARKER_STREAM,
    });

    // Parse bodies and return keys
    return rows
      .map((row) => {
        try {
          const body = JSON.parse(String(row.body));
          if (body && body.key) {
            return { key: body.key };
          }
        } catch {
          // ignore parse errors
        }
        return null;
      })
      .filter((item) => item !== null);
  }

  /**
   * Delete all logs associated with a webhook ID.
   * @param {string} webhookId
   * @returns {Promise<void>}
   */
  async deleteLogsByWebhookId(webhookId) {
    const sql = `DELETE FROM logs WHERE webhookId = $webhookId`;
    await executeWrite(sql, { webhookId });
  }

  /**
   * Cursor-based pagination for large datasets.
   * Uses (timestamp, id) as composite cursor for consistent ordering.
   * @param {LogFilters} filters
   * @returns {Promise<{ items: Array<LogEntry>, nextCursor: string | null }>}
   */
  async findLogsCursor(filters) {
    const { sql: whereSql, params } = this.#buildWhereClause(filters);
    const limit = Math.min(
      Number(filters.limit) || DEFAULT_PAGE_LIMIT,
      MAX_PAGE_LIMIT,
    );

    // Parse cursor: base64(timestamp:id)
    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, "base64").toString("utf-8");
        const lastColonIndex = decoded.lastIndexOf(":");
        if (lastColonIndex !== -1) {
          const cursorTs = decoded.substring(0, lastColonIndex);
          const cursorId = decoded.substring(lastColonIndex + 1);
          if (cursorTs && cursorId) {
            params.cursorTs = cursorTs;
            params.cursorId = cursorId;
          }
        }
      } catch {
        // Invalid cursor, ignore
      }
    }

    // Build cursor condition (descending: older than cursor)
    const cursorCondition = params.cursorTs
      ? `AND (timestamp < $cursorTs OR (timestamp = $cursorTs AND id < $cursorId))`
      : "";

    params.limit = limit + 1; // Fetch one extra to detect hasMore

    const sql = `
      SELECT * FROM logs
      WHERE ${whereSql} ${cursorCondition}
      ORDER BY timestamp DESC, id DESC
      LIMIT $limit
    `;

    const rows = await executeQuery(sql, params);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((rawRow) => {
      const row = this.#fixBigInts(rawRow);

      const entry = /** @type {LogEntry} */ ({
        ...row,
        headers: parseIfPresent("headers", row),
        query: parseIfPresent("query", row),
        body: parseIfPresent("body", row),
        responseHeaders: parseIfPresent("responseHeaders", row),
        responseBody: parseIfPresent("responseBody", row),
        signatureValid: row.signatureValid === true || row.signatureValid === 1,
      });

      // Strip undefined keys
      Object.keys(entry).forEach((k) => {
        const key = /** @type {keyof LogEntry} */ (k);
        if (entry[key] === undefined) delete entry[key];
      });

      return entry;
    });

    // Generate next cursor from last item
    let nextCursor = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      const cursorData = `${last.timestamp}:${last.id}`;
      nextCursor = Buffer.from(cursorData).toString("base64");
    }

    return { items, nextCursor };
  }
}

// Export singleton instance for backward compatibility (optional) or DI
export const logRepository = new LogRepository();
