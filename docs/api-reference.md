# API Reference

Complete reference for all HTTP endpoints exposed by the Webhook Debugger & Logger Actor.

---

## Base URL

```text
https://<actor-run-id>.runs.apify.net
```

For self-hosted instances:

```text
http://localhost:8080
```

---

## Authentication

Most management endpoints require authentication when `authKey` is configured in the Actor input.

### Methods

| Method              | Example                          |
| ------------------- | -------------------------------- |
| **Bearer Token**    | `Authorization: Bearer YOUR_KEY` |
| **Query Parameter** | `?key=YOUR_KEY`                  |

### Unauthenticated Endpoints

- `GET/POST /webhook/:id` - Webhook capture (unless `authKey` is set)
- `GET /log-stream` - SSE stream (optional auth)

---

## Rate Limiting

All management endpoints respect the configured `rateLimitPerMinute` setting.

### Response Headers

| Header                  | Description                             |
| ----------------------- | --------------------------------------- |
| `X-RateLimit-Limit`     | Maximum requests allowed per window     |
| `X-RateLimit-Remaining` | Remaining requests in current window    |
| `X-RateLimit-Reset`     | Unix timestamp when the window resets   |
| `Retry-After`           | Seconds to wait (only on 429 responses) |

### 429 Response

```json
{
  "status": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Max 60 requests per 60s."
}
```

---

## Endpoints

### Webhook Capture

#### `GET|POST|PUT|PATCH|DELETE /webhook/:webhookId`

Captures incoming webhook requests.

**Parameters:**

| Name        | Location | Type   | Description                                 |
| ----------- | -------- | ------ | ------------------------------------------- |
| `webhookId` | Path     | string | The webhook endpoint ID (e.g., `wh_abc123`) |
| `__status`  | Query    | number | Force a specific HTTP response code         |

**Request:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"event": "payment.success", "amount": 9999}' \
  https://<URL>/webhook/wh_abc123
```

**Response:**

Default response (configurable via `defaultResponseCode`, `defaultResponseBody`, `defaultResponseHeaders`):

```text
HTTP/1.1 200 OK
Content-Type: text/plain

OK
```

**Forced Status Example:**

```bash
curl https://<URL>/webhook/wh_abc123?__status=503
# Returns: HTTP/1.1 503 Service Unavailable
```

---

### Webhook Information

#### `GET /info`

Returns active webhook endpoints and Actor metadata.

**Authentication:** Required (if `authKey` configured)

**Response:**

```json
{
  "message": "Webhook Debugger Active",
  "webhooks": [
    {
      "id": "wh_abc123",
      "url": "https://<URL>/webhook/wh_abc123",
      "expiresAt": "2026-01-31T10:00:00Z"
    }
  ],
  "actorRunId": "abc123xyz",
  "startedAt": "2026-01-30T10:00:00Z"
}
```

---

### Log Retrieval

#### `GET /logs`

Query captured webhook events with filtering and pagination.

**Authentication:** Required (if `authKey` configured)

**Query Parameters:**

| Parameter        | Type    | Default | Description                            |
| ---------------- | ------- | ------- | -------------------------------------- |
| `webhookId`      | string  | -       | Filter by webhook ID                   |
| `method`         | string  | -       | Filter by HTTP method                  |
| `statusCode`     | number  | -       | Filter by response status code         |
| `contentType`    | string  | -       | Filter by content type (partial match) |
| `requestId`      | string  | -       | Find by specific request ID            |
| `remoteIp`       | string  | -       | Filter by client IP (CIDR supported)   |
| `signatureValid` | boolean | -       | Filter by signature validation status  |
| `limit`          | number  | 20      | Max results (max: 10000)               |
| `offset`         | number  | 0       | Pagination offset                      |
| `cursor`         | string  | -       | Cursor for cursor-based pagination     |

**Response:**

```json
{
  "items": [
    {
      "id": "evt_8m2L5p9xR",
      "webhookId": "wh_abc123",
      "timestamp": "2026-01-30T12:00:00Z",
      "method": "POST",
      "statusCode": 200,
      "size": 1240,
      "headers": { "content-type": "application/json" },
      "body": { "event": "payment.success" },
      "processingTime": 12,
      "signatureValid": true,
      "signatureProvider": "stripe"
    }
  ],
  "total": 150,
  "nextCursor": "MjAyNi0wMS0zMFQxMjowMDowMFo6ZXZ0XzhtMkw1cDl4Ug=="
}
```

---

### Log Detail

#### `GET /logs/:logId`

Get full details for a specific log entry.

**Authentication:** Required (if `authKey` configured)

**Response:**

```json
{
  "id": "evt_8m2L5p9xR",
  "webhookId": "wh_abc123",
  "timestamp": "2026-01-30T12:00:00Z",
  "method": "POST",
  "statusCode": 200,
  "headers": { ... },
  "body": { ... },
  "query": { ... },
  "responseHeaders": { ... },
  "responseBody": "OK",
  "signatureValid": true,
  "signatureProvider": "stripe"
}
```

---

### Log Payload

#### `GET /logs/:logId/payload`

Retrieve the full payload for a log entry (handles KVS-offloaded large payloads).

**Authentication:** Required (if `authKey` configured)

**Response:**

Returns the raw payload with appropriate `Content-Type` header.

---

### Request Replay

#### `POST /replay/:webhookId/:eventId`

Replay a captured webhook event to a new destination.

**Authentication:** Required (if `authKey` configured)

**Request Body:**

```json
{
  "targetUrl": "https://your-server.com/webhook",
  "maxRetries": 3,
  "timeout": 10000
}
```

| Field        | Type   | Default      | Description                      |
| ------------ | ------ | ------------ | -------------------------------- |
| `targetUrl`  | string | **Required** | Destination URL (SSRF-validated) |
| `maxRetries` | number | 3            | Max retry attempts               |
| `timeout`    | number | 10000        | Request timeout in ms            |

**Response:**

```json
{
  "success": true,
  "message": "Event replayed successfully",
  "response": {
    "status": 200,
    "data": { ... }
  }
}
```

**Error Response (SSRF Blocked):**

```json
{
  "success": false,
  "error": "URL resolves to internal/reserved IP range"
}
```

---

### Real-time Stream

#### `GET /log-stream`

Server-Sent Events (SSE) stream for real-time webhook monitoring.

**Authentication:** Optional

**Query Parameters:**

| Parameter   | Type   | Description                 |
| ----------- | ------ | --------------------------- |
| `webhookId` | string | Filter events by webhook ID |

**Event Types:**

| Event       | Description                       |
| ----------- | --------------------------------- |
| `log`       | New webhook captured              |
| `heartbeat` | Connection keep-alive (every 30s) |

**Example:**

```bash
curl -N https://<URL>/log-stream
```

**Stream Output:**

```text
event: log
data: {"id":"evt_123","webhookId":"wh_abc123","method":"POST","statusCode":200}

event: heartbeat
data: {"ts":"2026-01-30T12:00:30Z"}
```

---

### System Metrics

#### `GET /system/metrics`

Returns system health and performance metrics.

**Response:**

```json
{
  "uptime": 3600,
  "memoryUsage": {
    "heapUsed": 52428800,
    "heapTotal": 104857600
  },
  "activeWebhooks": 5,
  "totalRequests": 1524
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "status": 401,
  "error": "Unauthorized",
  "message": "Invalid or missing authentication key",
  "requestId": "req_abc123"
}
```

### Common Status Codes

| Code | Description                                 |
| ---- | ------------------------------------------- |
| 400  | Bad Request - Invalid parameters or payload |
| 401  | Unauthorized - Missing or invalid auth key  |
| 404  | Not Found - Webhook or log not found        |
| 429  | Too Many Requests - Rate limit exceeded     |
| 500  | Internal Server Error                       |

---

## SSRF Protection

The following URLs are blocked for `forwardUrl`, `targetUrl` in replay, and related operations:

- Private networks: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Loopback: `127.0.0.0/8`, `::1`
- Link-local: `169.254.0.0/16`, `fe80::/10`
- Cloud metadata: `169.254.169.254`, `100.100.100.200`

---

## Signature Verification

The Actor supports automatic signature verification for:

| Provider | Header                  | Algorithm                  |
| -------- | ----------------------- | -------------------------- |
| Stripe   | `Stripe-Signature`      | HMAC-SHA256 with timestamp |
| Shopify  | `X-Shopify-Hmac-Sha256` | Base64 HMAC-SHA256         |
| GitHub   | `X-Hub-Signature-256`   | `sha256=<hex>`             |
| Slack    | `X-Slack-Signature`     | `v0=<hex>` with timestamp  |
| Custom   | Configurable            | Configurable algorithm     |

Configure via `signatureVerification` in Actor input.
