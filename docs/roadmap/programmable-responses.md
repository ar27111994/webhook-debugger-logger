# Roadmap: Programmable Responses & Mock Service Virtualization

**Objective:** Transform the Actor from a passive logger into an active, programmable mock server capable of returning dynamic, context-aware responses based on incoming request properties.

**Target Audience:** Testing teams, API developers, webhook consumers (SupaHooks, etc.), and enterprise dashboard integrations.

---

## 1. Core Concept: "API-First Mocking"

Instead of relying solely on static configuration or complex JavaScript entered into a UI, this feature exposes a **Mock Rule Engine** controllable entirely via a REST API. This allows external platforms to programmatically configure the Actor to simulate specific scenarios (success, failure, delays, dynamic data) on the fly.

### The "Mock Rule" Model

A `MockRule` defines **Match Criteria** (when to run) and a **Response Definition** (what to return).

```json
{
  "id": "rule_order_success",
  "priority": 100,
  "match": {
    "method": "POST",
    "path": "/webhook/payment.*",
    "headers": { "x-event-type": "order.created" },
    "body": { "$.data.amount": { "$gt": 0 } }
  },
  "response": {
    "status": 201,
    "headers": { "content-type": "application/json" },
    "body": {
      "success": true,
      "orderId": "{{request.body.data.id}}",
      "timestamp": "{{system.timestamp}}"
    },
    "delay": 250
  }
}
```

---

## 2. API Design Specification

Management endpoints to control the mock engine. All endpoints require `authKey`.

### Manage Rules

#### `GET /mock-rules`

List all active mock rules, sorted by priority.

- **Query**: `?webhookId=...` (optional filter)
- **Response**: `Array<MockRule>`

#### `POST /mock-rules`

Create a new mock rule.

- **Body**: `MockRule` (excluding `id`, it's generated)
- **Validation**: Strict schema validation for matchers and templates.
- **Response**: `201 Created` with full rule object.

#### `PUT /mock-rules/:ruleId`

Update an existing rule entirely.

#### `PATCH /mock-rules/:ruleId`

Partial update (e.g., toggle `enabled: false`).

#### `DELETE /mock-rules/:ruleId`

Remove a rule.

#### `POST /mock-rules/reorder`

Bulk update priorities.

- **Body**: `[{ "id": "rule_1", "priority": 10 }, ...]`

### Testing & Debugging

#### `POST /mock-rules/simulate`

Test an incoming payload against registered rules to see which one _would_ match, without actually sending it to the webhook endpoint.

- **Body**: `{ "method": "POST", "headers": {...}, "body": {...} }`
- **Response**: `{ "matched": true, "ruleId": "rule_order_success", "generatedResponse": {...} }`

---

## 3. Technical Architecture

### 3.1. Rule Engine Components

1. **RuleEvaluator**: Fast, synchronous logic engine.
   - **Header/Path Matchers**: Exact string, RegEx, Glob.
   - **Body Matchers**: [JSONPath](https://github.com/dchester/jsonpath) for deep property inspection (e.g., `$.items[0].price > 100`).
2. **TemplateEngine**: Logic to hydrate response bodies.
   - Use a safe, logic-less templating system like **Mustache** or limited **Handlebars**.
   - **Context Available**:
     - `request.body.*`
     - `request.headers.*`
     - `request.query.*`
     - `system.timestamp`, `system.randomId`

### 3.2. Integration Point

The `MockMiddleware` will sit **before** the `LoggerMiddleware`'s logging logic but **after** body parsing.

**Flow:**

1. Receive Request
2. Parse Body & Headers
3. **Evaluate Mock Rules** (In-Memory)
4. _If Match Found:_
   - Generate Response (Delay, Status, Body)
   - Log Event (Mark as `type: "mocked"`, include `mockRuleId`)
5. Receive Request
6. Parse Body & Headers
7. **Evaluate Mock Rules** (In-Memory)
8. _If Match Found:_
   - Generate Response (Delay, Status, Body)
   - Log Event (Mark as `type: "mocked"`, include `mockRuleId`)
   - Send Response -> **STOP**
9. _If No Match:_
   - Proceed to standard Logging & Forwarding logic.

### 3.3. Persistence

We will use a **Hybrid Persistence Strategy**:

1. **Configuration (Rules) -> KeyValueStore (`MOCK_RULES.json`)**
   - **Reason:** Rules are "Configuration", not "Data". They are high-read (every request), low-write.
   - **Benefit:** Allows for easy manual editing/hot-reloading via the Apify Console JSON editor.
   - **Format:** Single JSON array. Atomic writes.

2. **Analytics (Logs) -> DuckDB**
   - **Reason:** Individual mock executions are "Events". They are high-volume and need to be queryable alongside real traffic.
   - **Benefit:** Enables SQL queries like "Show me all requests matched by `rule_payment_error` in the last hour".

### 3.4. Database Schema Changes (DuckDB)

To support this, the main `logs` table in DuckDB will need two new columns:

```sql
ALTER TABLE logs ADD COLUMN is_mocked BOOLEAN DEFAULT FALSE;
ALTER TABLE logs ADD COLUMN mock_rule_id VARCHAR;
```

This ensures that mocked requests appear in valid metrics (`GET /logs`) but can be easily filtered out (`WHERE is_mocked = FALSE`) for real traffic analysis.

---

## 4. Implementation Phases

### Phase 1: Static Rules (MVP)

- **Scope**: Exact match on method/header/path. Static JSON response.
- **Goal**: Enable simple "Always return 500 for this webhook" scenarios.
- **Deliverable**: API endpoints, Basic Matcher, Storage.

### Phase 2: Advanced Matching

- **Scope**: JSONPath body matching (`$.type == 'invoice'`).
- **Goal**: Differentiate responses based on payload content (Success vs. Failure simulation).
- **Deliverable**: `jsonpath` integration, complex matcher logic.

### Phase 3: Dynamic Responses

- **Scope**: Response templating (`Hello {{request.body.name}}`).
- **Goal**: Enable "Echo" scenarios and realistic ID generation.
- **Deliverable**: Template engine integration, context injection.

### Phase 4: Scripted Responses (Enterprise)

- **Scope**: Full JavaScript Sandbox for response generation.
- **Goal**: Complex logic (e.g., cryptographic signatures, stateful counting).
- **Deliverable**: Integration with existing `vm.Script` capabilities.

---

## 5. Security Considerations

- **Resource Limits**: Max mock rules (e.g., 50). Max response size (e.g., 50KB).
- **Sandboxing**: Template rendering must be pure (no FS access, no network).
- **SSRF**: If webhooks trigger callbacks, ensure SSRF protection (already implemented) applies.
