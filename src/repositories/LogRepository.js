/**
 * @file src/repositories/LogRepository.js
 * @description Data access layer for Logs (Read Model)
 */
import { executeQuery, getDbInstance } from "../db/duckdb.js";
import { tryParse } from "../utils/common.js";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
} from "../consts.js";

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
        source_offset
    ) VALUES (
        $id, $webhookId, $timestamp, $method, $statusCode, $size, $remoteIp, $userAgent, $requestUrl,
        $headers, $query, $body, $responseHeaders, $responseBody,
        $signatureValid, $signatureProvider, $signatureError,
        $requestId, $processingTime, $contentType,
        $sourceOffset
    )
    ON CONFLICT (id) DO UPDATE SET
        source_offset = COALESCE(EXCLUDED.source_offset, logs.source_offset)
`;

export class LogRepository {
  async #getDb() {
    return await getDbInstance();
  }

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
    const defaultClause = "timestamp DESC";

    if (!sortRules || sortRules.length === 0) {
      return defaultClause;
    }

    const clauses = sortRules
      .map((rule) => {
        const col = validSorts[rule.field];
        if (!col) return null;
        const dir = rule.dir.toUpperCase() === "ASC" ? "ASC" : "DESC";
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
    const where = ["1=1"];

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
      return /** @type {LogEntry} */ ({
        ...row,
        headers: tryParse(row.headers),
        query: tryParse(row.query),
        body: tryParse(row.body),
        responseHeaders: tryParse(row.responseHeaders),
        responseBody: tryParse(row.responseBody),
        signatureValid: row.signatureValid === true || row.signatureValid === 1,
      });
    });

    return { items, total };
  }

  /**
   * Get single log by ID
   * @param {string} id
   * @returns {Promise<LogEntry | null>}
   */
  async getLogById(id) {
    const sql = "SELECT * FROM logs WHERE id = $id";
    const rows = await executeQuery(sql, { id });
    if (rows.length === 0) return null;

    const rawRow = rows[0];
    const row = this.#fixBigInts(rawRow);
    return /** @type {LogEntry} */ ({
      ...row,
      headers: tryParse(row.headers),
      query: tryParse(row.query),
      body: tryParse(row.body),
      responseHeaders: tryParse(row.responseHeaders),
      responseBody: tryParse(row.responseBody),
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
    await executeQuery(INSERT_LOG_SQL, this.#mapLogToParams(log));
  }

  /**
   * Batch insert multiple logs in a single transaction
   * @param {Array<LogEntry>} logs
   * @returns {Promise<void>}
   */
  async batchInsertLogs(logs) {
    if (!logs.length) return;
    const db = await this.#getDb();
    const conn = await db.connect();

    try {
      await conn.run("BEGIN TRANSACTION");

      for (const log of logs) {
        await conn.run(INSERT_LOG_SQL, this.#mapLogToParams(log));
      }

      await conn.run("COMMIT");
    } catch (err) {
      try {
        await conn.run("ROLLBACK");
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      conn.closeSync();
    }
  }
}

// Export singleton instance for backward compatibility (optional) or DI
export const logRepository = new LogRepository();
