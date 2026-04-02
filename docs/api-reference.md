# API Reference

Complete reference for the HTTP endpoints exposed by the Webhook Debugger & Logger Actor in the current source branch.

The machine-readable OpenAPI contract for these routes lives in `.actor/web_server_schema.json` and is linked from `.actor/actor.json` via the Apify `webServerSchema` field.

---

## Base URL

Apify hosted run:

```text
https://example-run-id.runs.apify.net
```

Local or self-hosted instance:

```text
http://localhost:8080
```

---

## Authentication

When `authKey` is configured in Actor input, the application protects the dashboard and management endpoints with the same auth middleware.

### Supported Methods

| Method | Example |
| --- | --- |
| Bearer token | `Authorization: Bearer YOUR_KEY` |
| Query parameter | `?key=YOUR_KEY` |

### Auth-Protected When `authKey` Is Configured

- `GET /`
- `GET /info`
- `GET /logs`
- `GET /logs/:logId`
- `GET /logs/:logId/payload`
- `GET /log-stream`
- `POST /replay/:webhookId/:itemId`
- `GET /system/metrics`

### Never Auth-Protected

- `GET /health`
- `GET /ready`

### Webhook Ingest Auth

`/webhook/:id` is public only when `authKey` is not configured. If `authKey` is configured, webhook ingress uses the same auth validation utility as the management routes.

---

## Rate Limiting

### Management and Probe Endpoints

The configured `rateLimitPerMinute` applies to:

- `GET /`
- `GET /info`
- `GET /logs`
- `GET /logs/:logId`
- `GET /logs/:logId/payload`
- `GET /log-stream`
- `POST /replay/:webhookId/:itemId`
- `GET /system/metrics`
- `GET /health`
- `GET /ready`

### Webhook Ingest Limiter

`/webhook/:id` uses a separate per-webhook limiter. When it trips, the handler returns a webhook-specific `429` body and includes `Retry-After` plus standard rate-limit headers.

### Response Headers

| Header | Description |
| --- | --- |
| `X-RateLimit-Limit` | Maximum requests allowed per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp when the current window resets |
| `Retry-After` | Seconds to wait before retrying |

### Management `429` Example

```json
{
  "status": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Max 60 requests per 60s."
}
```

### Webhook Ingest `429` Example

```json
{
  "status": 429,
  "error": "Too Many Requests",
  "message": "Webhook rate limit exceeded. Max 10000 requests per minute per webhook.",
  "retryAfterSeconds": 60
}
```

---

## Endpoints

### Dashboard

#### `GET /`

Returns the built-in dashboard page. If the request `Accept` header includes `text/plain`, the route returns a compact plain-text summary instead of HTML.

**Authentication:** Required when `authKey` is configured

**Plain-text Example:**

```text
Webhook Debugger & Logger (v3.1.3)
Active Webhooks: 1
Signature Verification: STRIPE
```

---

### Webhook Capture

#### `ANY /webhook/:id`

Captures incoming webhook traffic for any HTTP method handled by Express.

**Authentication:** Required only when `authKey` is configured

**Path Parameters:**

| Name | Type | Description |
| --- | --- | --- |
| `id` | string | Active webhook identifier such as `wh_abc123` |

**Query Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `__status` | number | Overrides the response status code for this request when the value is a valid HTTP status |

**Request Example:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"event":"payment.success","amount":9999}' \
  https://example-run-id.runs.apify.net/webhook/wh_abc123
```

**Default Success Response:**

The route responds using the configured `defaultResponseCode`, `defaultResponseBody`, and `defaultResponseHeaders` unless a custom script overrides them.

```text
HTTP/1.1 200 OK
Content-Type: text/plain

OK
```

**Forced Status Example:**

If the effective status is `>= 400` and the response body is still the default success body, the middleware emits structured JSON instead of returning the plain success body.

```bash
curl "https://example-run-id.runs.apify.net/webhook/wh_abc123?__status=503"
```

```json
{
  "message": "Webhook received with status 503",
  "webhookId": "wh_abc123"
}
```

**Operational Notes:**

- Validates that the webhook exists and has not expired.
- Applies optional IP allowlisting through `allowedIps`.
- Applies optional auth validation when `authKey` is configured.
- Applies per-webhook rate limiting before body parsing.
- Streams large payloads to Apify KVS when they exceed the offload threshold.
- Applies optional JSON parsing, JSON Schema validation, signature verification, custom script execution, forwarding, and alerting.
- Blocks self-referential forwarding loops and returns `422 Unprocessable Entity` when recursion is detected.

---

### Runtime and Discovery Information

#### `GET /info`

Returns runtime metadata, active webhook state, discoverable endpoints, and the current feature list.

**Authentication:** Required when `authKey` is configured

**Response Example:**

```json
{
  "version": "3.1.3",
  "status": "Enterprise Suite Online",
  "system": {
    "authActive": true,
    "retentionHours": 72,
    "maxPayloadLimit": "10.0MB",
    "webhookCount": 1,
    "activeWebhooks": [
      {
        "id": "wh_abc123",
        "expiresAt": "2026-01-31T12:00:00.000Z"
      }
    ]
  },
  "features": [
    "High-Performance Logging & Payload Forensics",
    "Real-time SSE Log Streaming",
    "Smart Forwarding & Replay Workflows",
    "Isomorphic Custom Scripting & Latency Simulation",
    "Provider Signature Verification & Enterprise Security",
    "Large Payload Handling & Operational Health"
  ],
  "endpoints": {
    "logs": "https://example-run-id.runs.apify.net/logs?limit=100",
    "logDetail": "https://example-run-id.runs.apify.net/logs/:logId",
    "logPayload": "https://example-run-id.runs.apify.net/logs/:logId/payload",
    "stream": "https://example-run-id.runs.apify.net/log-stream",
    "webhook": "https://example-run-id.runs.apify.net/webhook/:id",
    "replay": "https://example-run-id.runs.apify.net/replay/:webhookId/:itemId?url=http://target.example/webhook",
    "info": "https://example-run-id.runs.apify.net/info",
    "systemMetrics": "https://example-run-id.runs.apify.net/system/metrics",
    "health": "https://example-run-id.runs.apify.net/health",
    "ready": "https://example-run-id.runs.apify.net/ready"
  },
  "docs": "https://apify.com/example/webhook-debugger-logger"
}
```

**Notes:**

- `version` is sourced from runtime package metadata. In the current branch source it resolves to `3.1.3` unless `npm_package_version` overrides it at runtime.
- `activeWebhooks` contains the webhook manager's persisted active state, which currently includes `id` and `expiresAt`.
- The discovery URL for `logs` intentionally includes `?limit=100` as a reasonable starter page size even though `/logs` itself defaults to a larger limit when `limit` is omitted.

---

### Log Retrieval

#### `GET /logs`

Queries captured webhook events from the DuckDB read model using offset- or cursor-based pagination.

**Authentication:** Required when `authKey` is configured

**Query Parameters:**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | string | - | Exact log ID |
| `webhookId` | string | - | Exact webhook ID |
| `requestUrl` | string | - | Partial match against the stored request URL |
| `method` | string | - | Exact HTTP method, normalized to uppercase |
| `statusCode` | number or range object | - | Exact code or range syntax such as `statusCode[gte]=400` |
| `contentType` | string | - | Partial match against stored content type |
| `requestId` | string | - | Exact request ID |
| `remoteIp` | string | - | Exact IP or CIDR block |
| `userAgent` | string | - | Partial match against user agent |
| `signatureValid` | boolean | - | Signature verification result |
| `signatureProvider` | string | - | Exact signature provider |
| `signatureError` | string | - | Exact signature error string |
| `processingTime` | number or range object | - | Exact or ranged processing time filter |
| `size` | number or range object | - | Exact or ranged payload size filter |
| `timestamp` | string or range object | - | Exact or ranged timestamp filter |
| `startTime` | ISO string | - | Convenience lower bound for timestamp filtering |
| `endTime` | ISO string | - | Convenience upper bound for timestamp filtering |
| `headers` | string or object | - | Substring search over serialized headers or keyed JSON filtering |
| `query` | string or object | - | Substring search over query JSON or keyed JSON filtering |
| `body` | string or object | - | Substring search over body JSON or keyed JSON filtering |
| `responseHeaders` | string or object | - | Substring search over response header JSON or keyed JSON filtering |
| `responseBody` | string or object | - | Substring search over response body JSON or keyed JSON filtering |
| `limit` | number | `10000` | Result limit. Invalid values are clamped to a minimum of `1`. |
| `offset` | number | `0` | Offset for traditional pagination |
| `cursor` | string | - | Cursor for keyset pagination. When present, it takes precedence over `offset`. |
| `sort` | string | `timestamp:DESC` | Comma-separated sort rules such as `timestamp:desc,method:asc` |

**Supported Sort Fields:**

`id`, `statusCode`, `method`, `size`, `timestamp`, `remoteIp`, `processingTime`, `webhookId`, `userAgent`, `requestUrl`, `contentType`, `requestId`, `signatureValid`, `signatureProvider`, `signatureError`

**Filter Syntax Notes:**

- Range filters use bracket notation, for example `statusCode[gte]=400`, `processingTime[lt]=1000`, or `timestamp[lte]=2026-01-30T12:00:00.000Z`.
- `startTime` and `endTime` are merged into the timestamp filter internally.
- Object filters support either a free-text match or keyed filtering such as `headers[x-request-id]=abc` or `body[event]=payment.success`.
- Nested object filters use dot notation in keyed JSON filters, for example `body[data.id]=evt_123`.

**Offset Pagination Response Example:**

```json
{
  "filters": {
    "limit": 100,
    "offset": 0,
    "sort": [
      {
        "field": "timestamp",
        "dir": "DESC"
      }
    ],
    "webhookId": "wh_abc123"
  },
  "count": 1,
  "total": 150,
  "items": [
    {
      "id": "evt_8m2L5p9xR",
      "webhookId": "wh_abc123",
      "timestamp": "2026-01-30T12:00:00.000Z",
      "method": "POST",
      "statusCode": 200,
      "size": 1240,
      "processingTime": 12,
      "requestId": "req_abc123",
      "requestUrl": "/webhook/wh_abc123",
      "contentType": "application/json",
      "signatureValid": true,
      "signatureProvider": "stripe",
      "detailUrl": "https://example-run-id.runs.apify.net/logs/evt_8m2L5p9xR"
    }
  ],
  "nextOffset": 100,
  "nextPageUrl": "https://example-run-id.runs.apify.net/logs?webhookId=wh_abc123&limit=100&offset=100"
}
```

**Cursor Pagination Difference:**

When `cursor` is used, the route returns `nextCursor` and `nextPageUrl` and omits `total` and `nextOffset`.

---

### Log Detail

#### `GET /logs/:logId`

Returns a single log entry from the read model.

**Authentication:** Required when `authKey` is configured

**Query Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `fields` | string | Optional comma-separated field list for sparse responses |

**Response Example:**

```json
{
  "id": "evt_8m2L5p9xR",
  "webhookId": "wh_abc123",
  "timestamp": "2026-01-30T12:00:00.000Z",
  "method": "POST",
  "statusCode": 200,
  "headers": {
    "content-type": "application/json"
  },
  "query": {},
  "body": {
    "event": "payment.success"
  },
  "responseHeaders": {},
  "responseBody": "OK",
  "signatureValid": true,
  "signatureProvider": "stripe"
}
```

**Notes:**

- If `fields` is supplied, the handler still fetches `webhookId` internally for security validation and strips it from the response if you did not request it explicitly.
- If the underlying webhook has expired or is no longer valid, the route returns `404` even when the log row still exists in DuckDB.

---

### Log Payload

#### `GET /logs/:logId/payload`

Returns the original payload for a log entry. If the payload was offloaded to Apify KVS, the route hydrates it on demand.

**Authentication:** Required when `authKey` is configured

**Response Behavior:**

- Returns the original `Content-Type` header when it was captured.
- Returns JSON when the stored payload is an object.
- Returns raw text when the stored payload is scalar text.
- Returns raw binary when the hydrated KVS value is a `Buffer`.

---

### Request Replay

#### `POST /replay/:webhookId/:itemId`

Replays a captured webhook event to a new destination URL after SSRF validation.

**Authentication:** Required when `authKey` is configured

**Query Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | string | Destination URL. Required. Subject to SSRF and DNS safety checks. |

**Request Example:**

```bash
curl -X POST \
  "https://example-run-id.runs.apify.net/replay/wh_abc123/evt_8m2L5p9xR?url=https%3A%2F%2Ftarget.example%2Fwebhook"
```

**Response Example:**

```json
{
  "status": "replayed",
  "targetUrl": "https://target.example/webhook",
  "targetResponseCode": 200,
  "targetResponseBody": "OK"
}
```

If the replay path strips masked or transport-managed headers, the response also includes:

```json
{
  "strippedHeaders": ["host", "content-length"]
}
```

**Replay Notes:**

- The route adds `X-Apify-Replay: true`, `X-Original-Webhook-Id`, and `Idempotency-Key` to the outbound request.
- Masked headers and transport-managed headers are removed before forwarding.
- If `itemId` does not resolve to a log ID but parses as a timestamp, the handler attempts a fallback lookup by timestamp within the specified webhook.
- Timeouts across all retry attempts return `504 Gateway Timeout` with a machine-readable `code` field when available.

**Common Replay Errors:**

Missing destination URL:

```json
{
  "error": "Missing 'url' parameter"
}
```

SSRF or DNS validation failure:

```json
{
  "error": "URL resolves to internal/reserved IP range"
}
```

```json
{
  "error": "Unable to resolve hostname"
}
```

---

### Real-Time Stream

#### `GET /log-stream`

Server-Sent Events (SSE) stream for live webhook monitoring.

**Authentication:** Required when `authKey` is configured

**Operational Behavior:**

- Compression is disabled for this route.
- The server enforces a maximum concurrent SSE client count, which defaults to `100`. When the limit is reached, the route returns `503 Service Unavailable`.
- The current implementation does not support a server-side `webhookId` query filter. Clients should filter streamed events locally.

**Wire Format Example:**

The stream uses plain SSE `data:` frames for log payloads plus comment frames for connection and keepalive traffic.

```text
: connected

data: {"id":"evt_123","webhookId":"wh_abc123","method":"POST","statusCode":200}

: heartbeat
```

**Notes:**

- There is no named `event:` field in the current implementation.
- Heartbeats are sent every 30 seconds as SSE comments.
- Streamed payloads are the live ingestion events produced by the middleware, not the paginated DuckDB `/logs` response shape.

---

### System Metrics

#### `GET /system/metrics`

Returns current sync-service metrics for the Dataset-to-DuckDB replication loop.

**Authentication:** Required when `authKey` is configured

**Response Example:**

```json
{
  "timestamp": "2026-01-30T12:00:00.000Z",
  "sync": {
    "syncCount": 12,
    "errorCount": 0,
    "itemsSynced": 1524,
    "lastSyncTime": "2026-01-30T11:59:59.000Z",
    "lastErrorTime": null,
    "isRunning": true
  }
}
```

---

### Health Probes

#### `GET /health`

Liveness probe for container and uptime monitoring.

**Authentication:** Not required

**Response Example:**

```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": "2026-01-30T12:00:00.000Z",
  "memory": {
    "heapUsed": 50,
    "heapTotal": 100,
    "rss": 140,
    "unit": "MB"
  }
}
```

#### `GET /ready`

Readiness probe for load balancers and orchestrators.

**Authentication:** Not required

**Response Example:**

```json
{
  "status": "ready",
  "timestamp": "2026-01-30T12:00:00.000Z",
  "checks": {
    "database": {
      "status": "ok"
    },
    "webhooks": {
      "status": "ok",
      "message": "1 active webhook(s)"
    }
  }
}
```

When a dependency is not ready, the route returns `503 Service Unavailable` and changes the top-level status to `not_ready`.

---

## Error Responses

Error bodies are intentionally small but they are not globally normalized into a single envelope. Different routes return different shapes depending on context.

### Common Error Shapes

Management and utility routes often return:

```json
{
  "error": "Some error label or message",
  "message": "Optional human-readable detail"
}
```

Webhook ingress validation failures often return additional context:

```json
{
  "error": "Webhook ID not found or expired",
  "id": "wh_abc123",
  "docs": "https://apify.com/example/webhook-debugger-logger"
}
```

Replay timeouts can also include an error code:

```json
{
  "error": "Replay Failed",
  "message": "Target destination timed out after 3 attempts (10s timeout per attempt)",
  "code": "ECONNABORTED"
}
```

### Common Status Codes

| Code | Description |
| --- | --- |
| `400` | Invalid parameters, JSON Schema validation failures, or unsafe replay URL |
| `401` | Missing or invalid auth key, or failed signature verification |
| `403` | Source IP is not in the configured allowlist |
| `404` | Webhook or log not found, invalid webhook/log pairing, or missing offloaded payload |
| `413` | Payload exceeds the configured maximum size |
| `422` | Recursive forwarding loop detected |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | Probe not ready, SSE connection limit reached, or similar temporary unavailability |
| `504` | Replay or forward timeout across retry attempts |

---

## SSRF Protection

The following URL classes are blocked for replay destinations, forwarding targets, and alert webhooks:

- Private networks: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Loopback: `127.0.0.0/8`, `::1`
- Link-local: `169.254.0.0/16`, `fe80::/10`
- Cloud metadata: `169.254.169.254`, `100.100.100.200`
- Hostnames that cannot be resolved safely

---

## Signature Verification

The Actor supports automatic signature verification for:

| Provider | Header | Algorithm |
| --- | --- | --- |
| Stripe | `Stripe-Signature` | HMAC-SHA256 with timestamp |
| Shopify | `X-Shopify-Hmac-Sha256` | Base64 HMAC-SHA256 |
| GitHub | `X-Hub-Signature-256` | `sha256=<hex>` |
| Slack | `X-Slack-Signature` | `v0=<hex>` with timestamp |
| Custom | Configurable | Configurable algorithm |

Configure via `signatureVerification` in Actor input.
