# **Architectural Review and Modernization Strategy for High-Throughput Apify Dataset Processing**

## **1\. Executive Summary and Gap Analysis**

This report provides a comprehensive technical analysis of the architectural requirements for implementing advanced, server-side filtering and sorting of Apify datasets within a Node.js ecosystem. It addresses the critical divergence between the current implementation—identified as an offset-based batch scanning mechanism—and the industry standards required for handling large, complex, and frequently accessed datasets securely.

### **1.1 Comparison with Original Requirements**

The core objective is to transition from a naive data-fetching model to a robust, scalable data processing pipeline. The original request highlights specific needs:

- **Advanced Filtering:** Range queries, numeric filters, and custom user-defined logic.
- **Efficiency:** Handling large datasets without blocking the event loop or exhausting memory.
- **Security:** safely executing "custom filtering functions" (untrusted code).
- **Architecture:** Moving away from "hacky" offset pagination.

Current industry analysis confirms that the "offset-based batch scanning" approach is fundamentally unscalable for large datasets due to the linear time complexity of offset operations (![][image1]) and the massive network overhead of fetching unfiltered data.

### **1.2 Proposed Strategic Pivot**

This report advocates for a paradigm shift from **Direct-Read Architecture** (streaming from Apify on every request) to a **Synchronization-Based Architecture** (ETL to an optimized query engine). By introducing an intermediate data store—specifically analyzing **MongoDB** for document flexibility and **DuckDB** for analytical performance—the application can offload compute-heavy sorting and filtering to engines designed for those tasks, reserving the Node.js runtime for API orchestration and secure sandbox execution.

## ---

**2\. Analysis of the Current Approach: The Offset Pagination Bottleneck**

The current implementation utilizes offset-based pagination to traverse Apify datasets. While functionally simple, this approach imposes severe performance penalties and scalability ceilings.

### **2.1 The ![][image1] Latency Trap**

Apify’s API, like many RESTful interfaces, supports pagination via limit and offset parameters.1 In an offset-based model, the database (or storage engine backing the API) must scan and discard the first ![][image2] records before returning the requested page.

- **Mechanics:** To fetch records 100,000 to 100,100, the system reads 100,100 records and discards the first 100,000.
- **Impact:** Latency increases linearly with dataset size. For deep pagination (e.g., accessing the last page of a 10-million-item dataset), response times can degrade from milliseconds to tens of seconds, often triggering HTTP timeouts (408 or 504 errors).3

### **2.2 Network and Memory Inefficiency**

Performing filtering _inside_ the Node.js application after fetching data from Apify is an "anti-pattern" for large datasets.

- **Bandwidth Waste:** If a filter matches only 1% of the data, the application still downloads 100% of the dataset over the network. This incurs high ingress costs and latency.
- **Event Loop Blocking:** JSON parsing is a CPU-synchronous operation in Node.js. Parsing gigabytes of JSON data to filter it blocks the main event loop, making the Express server unresponsive to other requests during the processing window.4
- **Heap Exhaustion:** Loading large batches into memory risks hitting the V8 heap limit (typically \~2GB-4GB depending on flags), causing FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed \- JavaScript heap out of memory.

### **2.3 The Sorting Impossibility**

Global sorting cannot be efficiently performed on a stream without buffering the entire dataset. To sort a 10GB dataset by "price," the application must fetch all 10GB, hold it in memory (or spill to disk), sort it, and then apply pagination. The current streaming approach likely either fails to sort globally (sorting only within the current page) or fails to scale (crashing on large datasets).

## ---

**3\. Security Architecture: Sandboxing Untrusted Code**

The requirement to support "custom filtering functions" (user-defined JavaScript) introduces a Critical Risk category: **Remote Code Execution (RCE)**.

### **3.1 Vulnerabilities in Native Node.js vm**

The native Node.js vm module is **not** a security mechanism.5 It provides context isolation but does not prevent:

- **Process Exit:** process.exit() can be called if the context is not strictly contextified.
- **Resource Exhaustion:** Infinite loops (while(true){}) can freeze the Node.js event loop, causing a Denial of Service (DoS).
- **Prototype Pollution:** Malicious code can modify shared object prototypes to compromise the host application.

### **3.2 Industry Standard: isolated-vm**

To securely execute untrusted code, the industry standard for Node.js is **isolated-vm**.6 This library provides access to V8's Isolate interface, creating a completely separate heap and garbage collector for the untrusted code.

#### **3.2.1 Implementation Strategy for Filter Functions**

The application should spin up a pool of isolates to handle incoming filter requests.

**Configuration Best Practices:**

1. **Memory Limits:** Configure memoryLimit (e.g., 128MB) for the isolate. If the user's filter attempts to allocate a massive array, the isolate will crash safely without affecting the main process.7
2. **Timeouts:** Enforce strict execution time limits (e.g., 50ms per item or 500ms per batch). isolated-vm allows synchronous execution with timeouts, preventing infinite loops from hanging the server.
3. **Stateless Execution:** The custom function should be treated as a pure function: f(item) \-\> boolean. No access to network, filesystem, or global state should be provided.
4. **Reference Transfer:** Use ExternalCopy to pass dataset items into the isolate efficiently. While there is serialization overhead, it ensures the untrusted code cannot mutate the original data in the host memory.8

**Code Structure Example (Conceptual):**

JavaScript

// Utilizing isolated-vm for secure execution  
const ivm \= require('isolated-vm');  
const isolate \= new ivm.Isolate({ memoryLimit: 128 });  
const context \= isolate.createContextSync();  
const jail \= context.global;

// Set up the user code  
const userCode \= \`(function(item) { ${userProvidedLogic} })\`;  
const script \= isolate.compileScriptSync(userCode);

// Execution wrapper  
const filterWrapper \= (item) \=\> {  
 // Pass data into the isolate  
 const itemRef \= new ivm.ExternalCopy(item).copyInto({ release: true });  
 // Run the function  
 const result \= script.runSync(context, { timeout: 100, arguments: });  
 return result \=== true;  
};

_Note: This architecture introduces CPU overhead. For high-throughput scenarios, isolates should be reused, or a "snapshot" of the compiled context should be used._.9

## ---

**4\. Architectural Pivot: The Sync-and-Query Model**

To satisfy the requirements of efficiency, range filtering, and global sorting, the application must move away from querying Apify directly for read operations. Instead, it should adopt a **Command Query Responsibility Segregation (CQRS)** pattern:

- **Write Path:** Data is scraped/written to Apify Datasets.
- **Sync Path:** Data is asynchronously replicated to a specialized Query Engine.
- **Read Path:** User queries (filters, sorts) are executed against the Query Engine.

### **4.1 Option A: MongoDB (Operational Flexibility)**

MongoDB is the most direct integration path for Apify datasets, which are JSON-based.11

- **Pros:** Native JSON support, flexible schema, powerful aggregation framework for range queries and sorting.
- **Implementation:** Use the apify/mongodb-import actor or a custom webhook listener.
  - **Incremental Sync:** Utilize the uniqueKey field (if available) or deduplication logic to update only changed records. Apify's webhooks (ACTOR.RUN.SUCCEEDED) can trigger an incremental fetch using the offset of the last known item, although createdAt based cursors are safer.11
  - **Indexing:** Create compound indexes on fields used for filtering (e.g., { price: 1, timestamp: \-1 }) to ensure ![][image3] query performance instead of ![][image1] scans.

### **4.2 Option B: DuckDB (Analytical Performance)**

For read-heavy workloads involving complex aggregations or heavy filtering on large datasets, **DuckDB** is the emerging market leader.12

- **Why DuckDB?** It is an in-process SQL OLAP database. It uses columnar storage, which is vastly more efficient for range queries (e.g., SELECT \* FROM items WHERE price \> 100\) than row-based stores like Mongo or standard Node.js objects.
- **Node.js Integration:** DuckDB can be embedded directly in the Node.js application. It can ingest JSON files or streams directly from disk or HTTP URLs.
- **Performance:** DuckDB utilizes vectorized execution, allowing it to process millions of rows per second on a single core. It supports "larger-than-memory" execution, spilling to disk gracefully if the dataset exceeds RAM, solving the heap exhaustion risk.13

**Recommendation:** If the primary use case is _filtering and sorting_ large flat datasets, **DuckDB** provides the highest performance-to-cost ratio. If the data is highly nested or requires frequent single-item updates, **MongoDB** is preferable.

## ---

**5\. Modern Data Ingestion Strategies**

The "hacky batch scanning" must be replaced with robust data pipelines.

### **5.1 Webhook-Driven Ingestion**

Instead of polling Apify, register **Webhooks** for critical events: ACTOR.RUN.SUCCEEDED or DATASET.ITEM.CREATED (if available via specialized actors, though usually run-based).

- **Payload:** The webhook provides the resourceId (Dataset ID).
- **Action:** The Node.js app receives the webhook and initiates a background job (using a queue like BullMQ or Agenda) to fetch and sync the data. This decouples the ingestion from user read requests.14

### **5.2 Handling Rate Limits**

Apify imposes rate limits (typically 60 req/s for standard endpoints, 400 req/s for data pushes).16

- **Solution:** Implement a **Token Bucket** or **Leaky Bucket** rate limiter. Libraries like bottleneck are industry standards in Node.js for managing upstream API concurrency.
- **Configuration:**  
  JavaScript  
  const Bottleneck \= require("bottleneck");  
  const limiter \= new Bottleneck({  
   minTime: 20, // Max 50 requests per second  
   maxConcurrent: 10  
  });  
  const limitedFetch \= limiter.wrap(apifyClient.dataset(id).listItems);

  This ensures compliance with Apify's limits while maximizing throughput via concurrency.18

### **5.3 Streaming with Backpressure**

When fetching data for synchronization, use Node.js **Streams**. Unlike await Promise.all(), streams process data in chunks.

- **Transform Streams:** Implement the data transformation (cleaning, normalization) as a Transform stream.
- **Backpressure:** Ensure the DB writer stream respects backpressure. If the DB writes are slower than the network download, the stream should pause the download. This prevents memory spikes.4

## ---

**6\. Advanced Server-Side Filtering Implementation**

### **6.1 Range Filtering (Numeric)**

Numeric range filtering (price \> 100 AND price \< 500\) is inefficient in raw JavaScript (requires iterating the whole array).

- **Database Approach:** simple SQL clause: WHERE price BETWEEN 100 AND 500\.
- **In-Memory Approach (Small Datasets):** If data fits in memory, use Array.prototype.filter. However, for high throughput, this blocks the event loop.
- **Worker Threads:** Offload the filtering logic to Node.js **Worker Threads**. This utilizes multi-core CPUs and keeps the main HTTP thread responsive.

### **6.2 Sorting Optimization**

- **The Problem:** Sorting is ![][image4]. Sorting 1 million objects in JS takes significant CPU time.
- **Solution:**
  - **Indexed Sort:** In MongoDB/SQL, sorting on an indexed field is ![][image5] (walking the B-Tree). This is the only scalable way to handle "Global Sorting" on large datasets.
  - **External Sort:** If using local files/DuckDB, the engine handles external sorting (spilling partial sorts to disk and merging), which Node.js cannot do natively without complex implementation.

## ---

**7\. Comparative Technology Stack Recommendations**

| Feature         | Current "Hacky" Approach     | Recommended: MongoDB Strategy                | Recommended: DuckDB Strategy   |
| :-------------- | :--------------------------- | :------------------------------------------- | :----------------------------- |
| **Data Source** | Direct API Stream            | Synced Collection                            | Synced Table/Parquet           |
| **Filtering**   | JS filter() (Slow/Blocking)  | Query Operators $gt, $lt (Fast/Indexed)      | SQL WHERE (Fastest/Vectorized) |
| **Sorting**     | JS sort() (Memory Intensive) | Index Scan (Instant)                         | Columnar Sort (High Perf)      |
| **Custom Code** | eval / vm (Insecure)         | isolated-vm (Secure) or Aggregation Pipeline | isolated-vm or UDFs (limited)  |
| **Latency**     | High (Network \+ Parse)      | Low (Local DB Query)                         | Very Low (In-Process OLAP)     |
| **Complexity**  | Low                          | Medium                                       | Medium-High                    |

## ---

**8\. Detailed Recommendation: The DuckDB-Node.js Architecture**

Given the user's focus on "property-based filtering" and "range filtering" for "frequently read" datasets, the **DuckDB** architecture offers a distinct advantage for analytics-style workloads.

### **8.1 Architecture Diagram**

1. **Ingestion Service:** A background worker listens for Apify webhooks. Upon a run completion, it streams the dataset items.
2. **Transformation:** The items are validated and transformed.
3. **Storage:** The worker writes the data to a local Parquet file (highly compressed, efficient) or directly inserts into a persistent DuckDB database file.
4. **Query Service (Express):**
   - **Simple Filters:** Converted to SQL. req.query.minPrice becomes SELECT \* FROM data WHERE price \>=?.
   - **Custom Filters:**
     - Step 1: Apply SQL filters first to narrow the dataset (e.g., 1M items \-\> 10k items).
     - Step 2: Stream the remaining 10k items into **isolated-vm**.
     - Step 3: Apply the user's JS function securely inside the sandbox.
   - **Sorting:** Handled entirely by DuckDB SQL ORDER BY.
   - **Pagination:** Handled by SQL LIMIT/OFFSET.

### **8.2 Why this wins:**

- **Pre-Filtering:** SQL filters eliminate data _before_ it hits the expensive JS sandbox.
- **Compression:** Parquet/DuckDB storage reduces disk usage by 5-10x compared to raw JSON.
- **Security:** Only the subset of data is exposed to the potentially malicious custom code.

## ---

**9\. Implementation Checklist & Best Practices**

### **9.1 Sanitization and Validation**

- **Input Validation:** Use **Joi** or **Zod** to strictly validate all incoming filter parameters. Ensure minPrice is actually a number, sortBy matches an allowed list of fields.
- **SQL Injection:** Always use parameterized queries. Never concatenate strings for SQL queries (even in DuckDB).
- **Filter Logic:** Block access to sensitive fields. If the dataset contains PII (Personally Identifiable Information), ensure the initial SQL query explicitly selects only public columns (SELECT id, name, price instead of SELECT \*).

### **9.2 Compute Best Practices**

- **Offload Heavy Lifting:** Never sort \>10k items on the main Node.js thread.
- **Compression:** Enable GZIP/Brotli compression for API responses. Large JSON payloads are highly compressible.
- **Pagination Design:** Prefer **Cursor-based pagination** (e.g., since_id) over offset pagination for the user-facing API. It is stable (records don't shift if new data is added) and efficient (![][image5]).21

### **9.3 Market Leader Implementations**

- **Segment / Mixpanel:** Use columnar stores (like ClickHouse or proprietary equivalents) to allow users to filter billions of events by properties instantly. They do not stream and filter in application logic.
- **Shopify:** Uses cursor-based pagination for all list endpoints to ensure stability and performance.
- **Cloudflare Workers:** Uses V8 Isolates (similar to isolated-vm) to run thousands of user scripts securely on the edge.

## **10\. Conclusion**

The transition from offset-based streaming to a synchronized database architecture is not merely an optimization; it is a prerequisite for scale. For the specific use case of filtering and sorting large, complex datasets:

1. **Immediate Fix:** Implement **isolated-vm** to secure the custom filter functions. Stop using offset for deep iteration; use lastId pointers if sticking to the API.
2. **Strategic Fix:** Deploy **DuckDB** as an embedded engine to handle the heavy lifting of range queries and sorting.
3. **Data Flow:** Invert the control flow. Do not pull data when the user asks; push data to your local store when Apify finishes, then serve the user from your optimized store.

This architecture aligns with industry standards for high-performance data APIs, ensuring security, low latency, and operational stability.

### **Citations**

1

#### **Works cited**

1. Dataset | API | SDK for Python \- Apify Documentation, accessed on January 24, 2026, [https://docs.apify.com/sdk/python/reference/class/Dataset](https://docs.apify.com/sdk/python/reference/class/Dataset)
2. Get list of datasets | Apify Documentation, accessed on January 24, 2026, [https://docs.apify.com/api/v2/datasets-get](https://docs.apify.com/api/v2/datasets-get)
3. Handling pagination | Academy \- Apify Documentation, accessed on January 24, 2026, [https://docs.apify.com/academy/api-scraping/general-api-scraping/handling-pagination](https://docs.apify.com/academy/api-scraping/general-api-scraping/handling-pagination)
4. Node.js Streams: Processing Large Files and Data Efficiently | Lead With Skills, accessed on January 24, 2026, [https://www.leadwithskills.com/blogs/nodejs-streams-processing-large-files-efficiently](https://www.leadwithskills.com/blogs/nodejs-streams-processing-large-files-efficiently)
5. VM (executing JavaScript) | Node.js v25.4.0 Documentation, accessed on January 24, 2026, [https://nodejs.org/api/vm.html](https://nodejs.org/api/vm.html)
6. laverdet/isolated-vm: Secure & isolated JS environments for nodejs \- GitHub, accessed on January 24, 2026, [https://github.com/laverdet/isolated-vm](https://github.com/laverdet/isolated-vm)
7. Securely Run User-Generated Code in Node.js with isolated-vm: A Step-by-Step Guide, accessed on January 24, 2026, [https://ridwandevjourney.vercel.app/posts/setup-isolated-vm-using-class/](https://ridwandevjourney.vercel.app/posts/setup-isolated-vm-using-class/)
8. Passing functions between isolates · Issue \#73 · laverdet/isolated-vm \- GitHub, accessed on January 24, 2026, [https://github.com/laverdet/isolated-vm/issues/73](https://github.com/laverdet/isolated-vm/issues/73)
9. Advice on running with an HTTP server · Issue \#106 · laverdet/isolated-vm \- GitHub, accessed on January 24, 2026, [https://github.com/laverdet/isolated-vm/issues/106](https://github.com/laverdet/isolated-vm/issues/106)
10. isolated-vm \- NPM, accessed on January 24, 2026, [https://www.npmjs.com/package/isolated-vm?activeTab=readme](https://www.npmjs.com/package/isolated-vm?activeTab=readme)
11. MongoDB Import Actor \- Apify, accessed on January 24, 2026, [https://apify.com/drobnikj/mongodb-import](https://apify.com/drobnikj/mongodb-import)
12. DuckDB in Action \- Chapter 10 \- Performance considerations for large datasets, accessed on January 24, 2026, [https://motherduck.com/duckdb-book-summary-chapter10/](https://motherduck.com/duckdb-book-summary-chapter10/)
13. Tuning Workloads \- DuckDB, accessed on January 24, 2026, [https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads)
14. Create webhook \- Apify Documentation, accessed on January 24, 2026, [https://docs.apify.com/api/v2/webhooks-post](https://docs.apify.com/api/v2/webhooks-post)
15. Events types for webhooks | Platform \- Apify Documentation, accessed on January 24, 2026, [https://docs.apify.com/platform/integrations/webhooks/events](https://docs.apify.com/platform/integrations/webhooks/events)
16. Apify API, accessed on January 24, 2026, [https://docs.apify.com/api/v2](https://docs.apify.com/api/v2)
17. Dataset | Platform \- Apify Documentation, accessed on January 24, 2026, [https://docs.apify.com/platform/storage/dataset](https://docs.apify.com/platform/storage/dataset)
18. p-limit vs async vs bottleneck vs rate-limiter-flexible vs promise-limit | JavaScript Concurrency Control Libraries Comparison \- NPM Compare, accessed on January 24, 2026, [https://npm-compare.com/async,bottleneck,p-limit,promise-limit,rate-limiter-flexible](https://npm-compare.com/async,bottleneck,p-limit,promise-limit,rate-limiter-flexible)
19. Rate limiting API calls \- sometimes a Bottleneck is a good thing \- DEV Community, accessed on January 24, 2026, [https://dev.to/rcoundon/rate-limiting-api-calls-sometimes-a-bottleneck-is-a-good-thing-1h5o](https://dev.to/rcoundon/rate-limiting-api-calls-sometimes-a-bottleneck-is-a-good-thing-1h5o)
20. How to use Streams \- Node.js, accessed on January 24, 2026, [https://nodejs.org/en/learn/modules/how-to-use-streams](https://nodejs.org/en/learn/modules/how-to-use-streams)
21. Offset pagination vs Cursor pagination \- Stack Overflow, accessed on January 24, 2026, [https://stackoverflow.com/questions/55744926/offset-pagination-vs-cursor-pagination](https://stackoverflow.com/questions/55744926/offset-pagination-vs-cursor-pagination)
22. A Developer's Guide to API Pagination: Offset vs. Cursor-Based \- Embedded Blog, accessed on January 24, 2026, [https://embedded.gusto.com/blog/api-pagination/](https://embedded.gusto.com/blog/api-pagination/)

[image1]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAZCAYAAAB3oa15AAAC6UlEQVR4Xu2Xy6tPURTHl1Dk/cgjyiMpZaC8UkYyoJAYEH+AiREDyUTJ/CZKMjGQkjLwDOWHiZhQRKKQiJJSFOXx/Vi/wz7r7HPuvf1+6g5+n/p2+639WnvtvdY+16xHjyHHSGlyNHYA802IxsEwUZopDY8NGVjovLQ1NnQAc56WhsWG/jgmfZbeSq+lH9IRaXzaKYGFrkj7Lb/YDfN50FOr9jkgnZJOJFrSbpsi7bXqmAozpNvSp9jQZpv0U7oWG8R7aXs0BjZJD6RX0sFy0x9GSOeknbFBnJFa0thg/8ts6b55pOuuwCTzPr+Cncg8kaYHe4QT3GXufK7/VOmmtCjYYZ30vf03ywVzx/qs/qiKCMUNzDJ3rolx0kVpqbTYfI7dpR5mq6Vb5oGKsLnH5ieBHxWYkPu+IDYksDESir6jEjtXY0vyOwdRvWzuHA4wx10rVxhOpy4QxdovzQNWAge427XH02a+9M7KJ1CcCpWqiZNWvttXzec5a14qceqO+Rp1bDQfUwkWu8axpsHARpkg3QBJ1bL8sacQ/fRu4wRB+yatktaaF4faJDXvw5h9qXGMeYlj99zTOjjCo+bOv0nsxQaaFobrVt4kV4crxHzMi1OHk/Yc5M8XCxsoHEBNTpAb5AgLHkrshSNNYyF3t0niIvd4AIlwE9kNFMnRsmYnqE4s9kialtgHcgKsUbm3Yp75aTIvN6CSnIHl0lcLGwCi25TEy8wft7oI8YI25Q/lse56UlKZu+JUBooAm10fG4AH7Jk0J7Hx/bPD/NgWJvbIHnMnI4xnHK87Qcq9L1QxantufIQc+Wj5h842SB/Mj+i4eefnbVvuaU+hilDDo40KU1QtdMnK70cBfXmomiiuKuV3dLnpH0SMROGbZrM01/JRi5DIdc51C6JO9OPr3TXuWfNnSKc8NP8i/W+skF5IK2NDFyAovFUd/WMzEPiKJVJpIegGzNvtOWtZY/2/qIOB8sx3VI8hyW9y8ZGwCQZGawAAAABJRU5ErkJggg==
[image2]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAAZCAYAAAA8CX6UAAAA/ElEQVR4Xu2Svw4BQRCHR6FQiKg8g0SQqEg8gEahkngAvSfwDKLSSNS6E4RSo1PqRa9W8ftlb2N37o9Eo7kv+ZLLzt7MzuyKZPyNHjzDW2jdD0sXruHCsentUMzgDj5gTcXIGM5hTgdcynALO/AFp17U/LyEI7UeoSomERMy0RVWnLgtxH2psBJbI3cxyYafsLTgUUzCRHS1NnyG8vuntkgB7sWcisPVhRJx27KwLSZim2xrA4vejhiYRB+bg+bAmSyuUAQe+wAbOiDmCTBRAAd+KAqrcZBxj4xrnNFJvrSVhxe4giUVs/DWUtuyV8yjWyfeDgNvsK8XMzLAG8lZMkafX9EIAAAAAElFTkSuQmCC
[image3]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEwAAAAZCAYAAACb1MhvAAAELklEQVR4Xu2YTahVVRTHV2iQWKYmfaDSUzQIhJBKCWoiDQw1xALFj5GDFBoZFebEiAYKRohBBCENSszAgZZpQS8FiXSgoCiig0KUHBgEiYlf6/fWWb191tn73vce3qdP7g/+3Hv33uecvddeH/tckS5dutznPKiaGBtHEI+KrWHIjFc9pRoVOzLwsN2qN2LHCGKB6ufYOBA+U/2juqD6U3VDtVU1Lh2UgLH2qdarHlC9KnYdupaMGw4eUp2W/ufvrXf3sUv1RaJ3xa6Dlaqnq+8teVJ1UPV37KhYqrqpOhA7lL9Uy2Kj8r7qVmwcBh5W/aD6Sez50+rdfbys+lU1IXaIOcuS2JgyRXVEzJNKIcWNGRMNgEedUj0R2uFuGexZ1S+qOarzqrfr3X28JRY1OX6sNCZ2OHvEFvapmAFyjFZ9J00DTJbyg++WwfCO7WK5d5s0N9TXsiJpS8GY/6leih0OiyJfzYgdCRjya7GxHu/wupTdt2Qw7vWYWEF5PPSlULF8oVzzjOrN/u4ibKAb43mxOaQpY5KYB+KJOV5UXRGbfwMWTG6aHzsC01UXpW4A3ykWniMajEW/I82wpzDQ7t5Nnkw38Fux3Mri10r70s/1aW5ifXjMK9Vv5vVxf3cDcmCv6pDqkXqX7QaGwCCtwLAsPjWA3ziXOCEajAX/K83cQL7AILOr3yyQ8j62+u33KYV+JI7rFbt+h9gmk4JYTwki6HvVHxKcgQkxsawlE9h5cgEPJYk6bjA+c0SDsZBciH4l1u67znc8l8WB34dx7WCuMTcRjlzPpswSW287B+FZDYP5glFp0UBoECI89KOknfPXb1K+NjWYb07OYB+ItbOr7C4LoyK753r/mup3K8hPMTeRB0n8Pn8O2GkezpE1mCfyXikvGqiePOyE1JP0YDzMx+YM5uM8DLeIheUGsSMPBtwntkHtIGHnomWj2DOIkGwyT3C7NAwGeE+rpP+C2IQ5vedgJ0ruHUOSpEvyjQbGS9MyflQsdAaLF6EcaVrhKNQKP3OmebQGB9YzUn8l4AyzXCxJU85LrBM7NUeoZHgKE/R3USb9nmp19d3brku9SmJAKucx1Zdiry8fqp5LxkTYBM5PV6UcbmwIG+O5sYSfCGLx+J+FqktiZ4/PxZLv2aotJtAIk2CiKYvEDJWKNmDB3JvXKaojn69V7Q7vdvF6F++BkZ1SH0PE5CICQ1Ep20EFxYlKUdcHXkDZp6IsVvVIeTdTyCuerAeD/xPCZwrPvCzmtakX9qi+ETNGp8GzKBIUi47wu7R+rRoMnNG4H28CkXliUdBpTooVm47BS+451dzYMUQOi4Ut3s7EZ6o+ETPWpmRcJ+iR5ptIR+Ahx2WA/yW1gfSA8TeLVSpyFHlyajqoA5Be9sudiZQBQci0eke716GCr4qNXboMD7cBCErvcDXI35sAAAAASUVORK5CYII=
[image4]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGEAAAAZCAYAAAAhd0APAAAE3klEQVR4Xu2ZWci1UxTH/0KR2SdDlFkpSZlSrkyRMQrhzoUbbj4X+u6U3LhCpgzpuxDpK8o8lIML0wWKSBQSISlFIcP6WWf1rmed/ezzfvUOX97zr3/vOXvvZ+/1rPnsV1pggQUW+N9iV+P+dXADA33sUwe3F/saDzHuXCca4LCnjFfUiQ0MdPKY8cY6sRzca/zF+K3xa+NfxruNe+dFCRz2gnGLcacyB96W7wM/KHOAvR8xPjjlXcYj0vwexifkz/8gd4y1xElakv9T403D6f+wVUvyQ54Bm4xvqa2XGRxsfMP4c52Y4irj38aX64The+PVdbDgFuPrxl/VXruffP7MOpGA8r+a/l1rXCJ3IM7/p8yBXYzbjNfWCfncxLhnGR/gMON7co8fSycoiTVVACz8ifGgMp6xmzxVnW983PiicffBCul442vGA8p4xnoagWi9wXirXAf1fZEb+XmPFv6Qv/8onpFvfKfGwyYsXY1wqFzAHjDyRL4WQYioKhAexP6cM4b1NMKzxpONJ8izRc3zRDCRjLO28LHcAUffD8WS/4+pEwkYhyLDWjw7QJhenr63cI6WBCAk2aMKFJ7WQ88IyMQ47IU9zcaB08/UmvOMZy9Nj+J5uYKR+WF5ncudD7L3nBHdfSl3xBmgxJZnVhxl/E7DSIjoaCklg0jLuZ70xT63yY2Lh72icS8KtIxwuPEjDRXCZ8aYC5Bq4zzwu/F+eQNA0Z+HnOtJpcj/pLwNBW/KdTSGi+XPNB0W66Hc3gYAY7FJNgIeN9F85VHMc66nSLPPN8Yj5V70qMZTYaAaIbwSJ6pgDCWzhijhvAvSPPv8pPEcnsH71XXsjyHPmH7nHXsRSDbgGd59AMLxVbkV9ypzGSjnHi0pLhBG6B0O8JicelA8+7AfuRUDtLqKimoEFIMis0wBurBwLiLjTw2jkX1YQxTOA2uqo5GOkB+9oJ/bh9MzYA/OmzFCKBH2FEmtoGZECgnwcgjTexbUXJ+N+q76XUVGNQKezR6MVWAYPA8P5DzWZUMzT8qK+tBDlR/gPOyJXijWnNPDqBEQjoIxUV+RdE0cWIVeTiQQYafWQXkYE87sS9Hr7RGoRog82zICYzkFETF0KCjjWHnL2MzPBaGjihzN1JRmwU1AB7+pYQSAl/cK8ynylmzM0lvVryd4Hy/SQrSr1JvloBqBokiqQxEVjOUOLNLG9oIU9lIdnIIIQDet8yvQQ3aKGdA5fKZhN8F90TXyEDoujVdsVvtXLgrC+l9o9odNINJZz4gZJ8qvLY5OY8iM7PziD/C5dkcYm2efll8r3Ge8TuNXMbw/780tAjK2DIiBMTT1Zh6oGd1G4CK5gITLA/IHPp+OzSuYpJWaM7mWwOqZYz00a/PvjhYi7eX9+B4pDKUj+ztT8rne5kZbXImTXZjWBSJVBp9TW07enzPnYaL2TcEAWJ58iVIuk/fPLetX4M1jAq4liDwiDkbvHiDSuCCkGwwg75XGH+WevtogCijmqwY6nN6Vx3rjXHnqqcArt8lT12qCZubmOrjSOE2e+0+vEzsIcA5S1EPyYkphv9T4vjztxrXzaoCzt2gF/rmzHHD7+qGGxXBHAvf618u7Of4ncIfxLM2mrpUGeuH2ec3AS8375biRQC3iWiV3bgsssMAM/gWHAhjTrGwUWwAAAABJRU5ErkJggg==
[image5]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAZCAYAAABD2GxlAAACV0lEQVR4Xu2WO2hUQRSG/+ADg+8QfKCiCWJllxARrCSFhUpICkVJbWOVJlhLSkFEIUUaCzvBIogiFoNCEC1EUAQxRSQosQkEtJGo/5/Z0bnHuTO7Ye32g4+Qc+Zxdh73XqBDh5bZRHtsMEMX3W2DrbCL7qcbbCLBTvqAjtlEBhV4Fb5vS9yhK/Qz/URX6S26I24UoQke0Wvwk6Y4hHR/tVffYpH76DO6bBMNLtCf9IlNkCV60cT20Dn4Hyd/0XOVFn9RXy3IgE0EDtJX8APVbZHOitpoohitwHu618R1LFSkjolDvkD11Ri3UbMDs/AD3ERNA7KR3se/BR6A3/4cDvkChcZYpH02IdRZ5+2oTUSo8HvwbbdE8fN0NPo/hUO5QI2hNhqvggI6W2dswtBPv6C6gmFVddNzOJQL1BgL8ItQQUuriVVADv0QTRIXuA1+8tKzzKFcYC99B9/2D1vpU/qcbo8TBm2vDrAm0TkJhAL1N4dDucAwlkwGc5PobOqMapLrUVzPrhfI9xUO6ywwHHwFc5PodmuCt/CPjkA7V1A7qJ10Jr62OrlLMgj/8B62iQZ3UT6/DuUCwyWcsQmhB/QHejiK6UF7iX6jx6K4ZYKeskHDa/gCx+E/KFJojB/0ik2Is/Qr/U6n6RT92IhdjtqlOIn0oGH7w82PTa3kJPxOHbeJgFZM70K9F0foEdS/VWJ0UR6i+vBuFfXVGI9pt8m1hZfIvyZLqK8+QkqXbd0M0Xl6wiaaRH01xn9FX0FvUL1ozaD2pXd52zgNf8GaZTO9YYMd2sVvuHt+/+sWw9cAAAAASUVORK5CYII=
