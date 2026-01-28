---
trigger: model_decision
description: Guidelines for working with the databases
---

# **Antigravity Rules: Node.js, Apify & DuckDB CQRS**

**Core Philosophy:** "Write fast, Read smart."

The system separates the burden of _ingestion_ (Apify Dataset) from the complexity of _querying_ (DuckDB).

## **1\. Architecture: Hybrid CQRS (Command Query Responsibility Segregation)**

### **1.1 The Write Model (Command)**

- **Role:** High-throughput ingestion. Zero logic beyond validation.
- **Storage:** **Apify Dataset** (Append-only).
- **Constraint:** NEVER run complex filtering or scanning against the Dataset directly during HTTP requests.
- **Data Flow:** POST /webhook → Validator → Apify.pushData() → ACK 200\.

### **1.2 The Read Model (Query)**

- **Role:** Complex filtering, sorting, aggregation, and searching.
- **Engine:** **DuckDB** (Embedded OLAP).
- **Lifecycle:**
  - **Startup:** Initialize an in-memory (:memory:) or temp-file DuckDB instance.
  - **Sync:** Periodically (or event-driven) sync new items from the Apify Dataset into DuckDB using read_json_auto.
  - **Query:** All GET /logs requests hit DuckDB, not the Dataset.
- **Constraint:** The Read Model is _disposable_. If the actor restarts, it rebuilds from the Dataset (Source of Truth).

## **2\. DuckDB & Data Access Patterns**

### **2.1 The "SQL-First" Rule**

- Do not fetch data into JavaScript to filter it. Push **ALL** predicates down to the SQL layer.
- **Bad:** results.filter(row \=\> row.status \=== 500\)
- **Good:** SELECT \* FROM logs WHERE status \= 500

### **2.2 Connection & Concurrency**

- Use a **Singleton Connection Pool**. DuckDB in Node.js is single-process.
- Use duckdb-async or wrap the native duckdb driver in Promises. Do not use callback-style DB code.
- **Schema:** define a strict schema in DuckDB even if input is JSON. Use CREATE TABLE logs (...) rather than relying solely on schema inference, to prevent type instability.

### **2.3 Type Safety & BigInt**

- DuckDB uses BigInt for integers by default. Node.js JSON.stringify crashes on BigInt.
- **Rule:** Always apply a global serializer patch or explicitly cast columns in SQL.
  - _SQL Approach:_ CAST(processingTime AS INTEGER)
  - _JS Approach:_  
    BigInt.prototype.toJSON \= function() { return Number(this) }

### **2.4 Query Optimization (The "Index" Strategy)**

- Although DuckDB is a column store (fast scans), create **indexes** on high-cardinality columns used in WHERE clauses (e.g., request_id, webhook_id).
- **Ingestion:** Use bulk inserts (Appender or INSERT INTO ... SELECT) rather than single-row inserts.

## **3\. Type-Safe JavaScript (JSDoc)**

We do not use TypeScript transpilation (.ts). We use **JSDoc** with strict type checking enabled in jsconfig.json.

### **3.1 Strict Typing Rules**

- **@ts-check:** Every file must implicitly or explicitly pass type checking.
- **Typedefs:** Centralize shared types in typedefs.js.
- **No any:** Avoid \* or any. Define specific shapes for WebhookPayload or QueryFilters.

### **3.2 Code Style Example**

/\*\*  
 \* Executes a read-only query against the DuckDB read model.  
 \* @param {string} sql \- Parameterized SQL query  
 \* @param {Array\<string|number\>} params \- Bind parameters  
 \* @returns {Promise\<Array\<import('./typedefs').LogEntry\>\>}  
 \*/  
export async function queryReadModel(sql, params) { ... }

## **4\. Apify Actor Specifics**

### **4.1 Ephemeral Storage**

- **Assumption:** The local filesystem is fast but ephemeral.
- **DuckDB Location:** Use process.env.APIFY_LOCAL_STORAGE_DIR or a temp dir for the .duckdb file if checking to disk.
- **Memory Limit:** Apify Actors have hard memory limits. DuckDB can be greedy.
  - **Config:** Set SET memory_limit='512MB' (or 75% of container limit).
  - **Temp:** Configure SET temp_directory='...' to spill to disk when memory is full.

### **4.2 Security (SSRF & SQLi)**

- **SQL Injection:** NEVER concatenate strings into SQL queries. ALWAYS use prepared statements (?).
  - _Allowed:_ db.all('SELECT \* FROM logs WHERE id \= ?', \[id\])
  - _Forbidden:_ db.all('SELECT \* FROM logs WHERE id \= ' \+ id)
- **SSRF:** Keep the existing ssrf.js module. Validate user-provided Webhook URLs _before_ the Command (Write) phase.

## **5\. Express & API Design**

### **5.1 Controller Pattern**

- Controllers are thin. They parse input, call the Domain/CQRS layer, and return JSON.
- **Validation:** Use zod or strict manual validation for req.query before passing to DuckDB.
  - _Why?_ To ensure limit is a number, sort is a valid column, preventing SQL syntax errors.

### **5.2 Error Handling**

- Use a centralized Error Handler middleware.
- Distinguish between **Operational Errors** (400 Bad Request, 404 Not Found) and **System Errors** (500 Database Crash).
- **DuckDB Errors:** Catch specific DuckDB codes (e.g., "binder error" usually means bad column name) and map them to 400 Bad Request if caused by user input.

## **6\. Modernization Checklist (Migration from Linear Scan)**

1. \[ \] **Install:** npm install duckdb
2. \[ \] **Init:** Create src/db.js singleton.
3. \[ \] **Schema:** Define CREATE TABLE IF NOT EXISTS logs (...).
4. \[ \] **Sync Loop:** Create a background loop in main.js that:
   - Checks Dataset.getInfo().itemCount.
   - Fetches new items since last offset.
   - Inserts into DuckDB.
5. \[ \] **Refactor:** Replace logs.js loop with db.all('SELECT ...').

## **7\. Data Access Strategy: No ORM**

### **7.1 The "SQL is the API" Rule**

- **Rule:** Do NOT use an ORM (Prisma, TypeORM, Sequelize).
- **Reason:** DuckDB features (window functions, read_json_auto, JSON extraction) are best expressed in raw SQL. ORMs add overhead and obscure the columnar nature of the DB.
- **Exception:** You MAY use a lightweight query builder like Kysely _only if_ strict TypeScript support is required, but raw parameterized SQL is preferred for simplicity in JSDoc projects.

### **7.2 Safety & Organization**

- **Parameterized Queries:** NEVER use template literals ${var} for user input. Always use the driver's parameter binding (? or $1).
  - _Bad:_ db.all(\\SELECT \* FROM logs WHERE id \= '${req.query.id}'\`)\`
  - _Good:_ db.all('SELECT \* FROM logs WHERE id \= ?', \[req.query.id\])
- **Repository Pattern:** Do not write SQL inside your Express Controllers. Encapsulate SQL in src/repositories/LogRepository.js.

### **7.3 Handling Dynamic Filters (The "Builder" Pattern)**

Since you have complex filters, you need to build SQL strings dynamically _safely_.

// src/repositories/LogRepository.js

/\*\*  
 \* Builds and executes a search query.  
 \* @param {import('../typedefs').LogFilters} filters  
 \*/  
export async function findLogs(filters) {  
 const params \= \[\];  
 let sql \= 'SELECT \* FROM logs WHERE 1=1'; // 1=1 allows easy appending of AND clauses

    if (filters.statusCode) {
        sql \+= ' AND statusCode \= ?';
        params.push(filters.statusCode);
    }

    // DuckDB JSON extraction example
    if (filters.webhookId) {
        sql \+= ' AND webhookId \= ?';
        params.push(filters.webhookId);
    }

    // Efficient Range Filtering on Integers
    if (filters.processingTimeGt) {
        sql \+= ' AND processingTime \> ?';
        params.push(filters.processingTimeGt);
    }

    sql \+= ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(filters.limit || 100, filters.offset || 0);

    return db.query(sql, params);

}

### **7.4 DuckDB Specific Optimizations**

- **SELECT Specific Columns:** Avoid SELECT \* if you only need the ID and Status. Columnar databases run faster when fetching fewer columns.
- **Limit Early:** Always include LIMIT in user-facing queries.
- **Cast JSON:** When querying JSON columns, cast strictly.
  - SELECT headers-\>\>'$.host' AS host FROM logs
