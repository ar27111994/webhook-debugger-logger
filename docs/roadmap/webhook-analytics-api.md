# Webhook Analytics API Plan

**Target Release**: v3.x (Future)  
**Priority**: Enhancement  
**Status**: Planned

---

## Overview

Expose analytics endpoints and event hooks that external clients (SupaHooks, custom SaaS platforms, enterprise dashboards) can consume to build trend visualizations, usage reports, and alerting systems.

> **Design Principle**: This Actor provides the **data layer**. External clients handle visualization and storage.

---

## Design Goals

1. **API-first**: All analytics accessible via REST endpoints
2. **Streaming support**: Real-time metrics via SSE for live dashboards
3. **Pluggable hooks**: Event callbacks for external aggregation pipelines
4. **Zero storage overhead**: Aggregations computed on-demand or delegated to clients
5. **NPM package compatibility**: Works standalone without Apify platform

---

## API Endpoints

### GET /analytics/summary

Returns aggregated metrics for the current session.

```json
{
  "sessionStart": "2026-01-30T10:00:00Z",
  "uptime": 3600,
  "totals": {
    "requests": 1524,
    "success": 1498,
    "errors": 26,
    "forwarded": 1200,
    "replayed": 45
  },
  "byWebhook": {
    "wh_abc123": { "requests": 800, "errors": 10 },
    "wh_xyz789": { "requests": 724, "errors": 16 }
  }
}
```

**Query Parameters:**

| Param       | Type    | Description                         |
| ----------- | ------- | ----------------------------------- |
| `webhookId` | string  | Filter to specific webhook          |
| `since`     | ISO8601 | Start time (default: session start) |

---

### GET /analytics/timeseries

Returns time-bucketed counts for charting.

```json
{
  "interval": "5m",
  "buckets": [
    { "timestamp": "2026-01-30T10:00:00Z", "requests": 42, "errors": 1 },
    { "timestamp": "2026-01-30T10:05:00Z", "requests": 58, "errors": 0 },
    { "timestamp": "2026-01-30T10:10:00Z", "requests": 37, "errors": 2 }
  ]
}
```

**Query Parameters:**

| Param       | Type   | Default    | Description                                        |
| ----------- | ------ | ---------- | -------------------------------------------------- |
| `interval`  | string | `5m`       | Bucket size: `1m`, `5m`, `15m`, `1h`, `1d`         |
| `webhookId` | string | -          | Filter to specific webhook                         |
| `metric`    | string | `requests` | `requests`, `errors`, `latency_p50`, `latency_p95` |
| `limit`     | number | 100        | Max buckets to return                              |

---

### GET /analytics/stream (SSE)

Real-time metric updates for live dashboards.

```bash
event: metric
data: {"type":"request","webhookId":"wh_abc123","latency":12,"status":200}

event: metric
data: {"type":"request","webhookId":"wh_abc123","latency":8,"status":201}

event: summary
data: {"requests":1525,"errors":26,"rps":2.4}
```

**Stream Events:**

| Event     | Frequency   | Payload                             |
| --------- | ----------- | ----------------------------------- |
| `metric`  | Per request | Individual request data             |
| `summary` | Every 10s   | Rolling aggregates                  |
| `alert`   | On trigger  | Alert context (if alerting enabled) |

---

## Event Hooks (NPM Package)

For clients using the package directly (not via Apify), expose programmatic hooks.

### Configuration

```javascript
import { WebhookDebugger } from 'webhook-debugger-logger';

const debugger = new WebhookDebugger({
  urlCount: 5,
  analytics: {
    enabled: true,
    onRequest: (event) => {
      // Push to external time-series DB (InfluxDB, TimescaleDB, etc.)
      sendToInflux(event);
    },
    onSummary: (summary) => {
      // Update external dashboard state
      dashboardState.update(summary);
    },
  },
});
```

### Hook Signatures

```typescript
interface AnalyticsHooks {
  /** Called for every captured webhook */
  onRequest?: (event: RequestMetric) => void | Promise<void>;

  /** Called periodically with aggregated stats */
  onSummary?: (summary: SessionSummary) => void | Promise<void>;

  /** Called when a request matches alert conditions */
  onAlert?: (alert: AlertContext) => void | Promise<void>;
}

interface RequestMetric {
  timestamp: string;
  webhookId: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  size: number;
  signatureValid?: boolean;
  forwarded?: boolean;
  forwardStatus?: "SUCCESS" | "FAILED";
}

interface SessionSummary {
  uptime: number;
  totalRequests: number;
  totalErrors: number;
  requestsPerSecond: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}
```

---

## Implementation

### [NEW] src/analytics/AnalyticsCollector.js

```javascript
import { EventEmitter } from "events";

export class AnalyticsCollector extends EventEmitter {
  #metrics = [];
  #sessionStart = Date.now();
  #summaryInterval = null;

  constructor(options = {}) {
    super();
    this.hooks = options.hooks || {};
    if (options.summaryIntervalMs) {
      this.#startSummaryEmitter(options.summaryIntervalMs);
    }
  }

  record(metric) {
    this.#metrics.push({ ...metric, timestamp: Date.now() });
    this.emit("request", metric);
    this.hooks.onRequest?.(metric);

    // Prune old metrics (keep last hour in memory)
    const oneHourAgo = Date.now() - 3600000;
    this.#metrics = this.#metrics.filter((m) => m.timestamp > oneHourAgo);
  }

  getSummary() {
    const requests = this.#metrics.length;
    const errors = this.#metrics.filter((m) => m.statusCode >= 400).length;
    const latencies = this.#metrics
      .map((m) => m.latencyMs)
      .sort((a, b) => a - b);

    return {
      uptime: Math.floor((Date.now() - this.#sessionStart) / 1000),
      totalRequests: requests,
      totalErrors: errors,
      requestsPerSecond: requests / ((Date.now() - this.#sessionStart) / 1000),
      avgLatencyMs:
        latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
    };
  }

  getTimeseries(interval = "5m", metric = "requests") {
    // Bucket logic here
  }

  shutdown() {
    clearInterval(this.#summaryInterval);
  }
}
```

### [NEW] src/routes/analytics.js

```javascript
import { asyncHandler } from "./utils.js";

export const createAnalyticsRoutes = (analyticsCollector) => {
  return {
    summary: asyncHandler(async (req, res) => {
      res.json(analyticsCollector.getSummary());
    }),

    timeseries: asyncHandler(async (req, res) => {
      const { interval = "5m", metric = "requests" } = req.query;
      res.json(analyticsCollector.getTimeseries(interval, metric));
    }),

    stream: (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");

      const onRequest = (metric) => {
        res.write(`event: metric\ndata: ${JSON.stringify(metric)}\n\n`);
      };

      analyticsCollector.on("request", onRequest);
      req.on("close", () => analyticsCollector.off("request", onRequest));
    },
  };
};
```

---

## Input Schema Additions

```json
{
  "analyticsEnabled": {
    "type": "boolean",
    "title": "Enable Analytics API",
    "description": "Expose /analytics endpoints for external consumption.",
    "default": false
  },
  "analyticsSummaryIntervalMs": {
    "type": "integer",
    "title": "Summary Broadcast Interval (ms)",
    "description": "How often to emit summary events on SSE stream.",
    "default": 10000,
    "minimum": 1000
  }
}
```

---

## External Client Integration Examples

### SupaHooks (SaaS Platform)

```javascript
// SupaHooks backend consuming analytics
const eventSource = new EventSource(`${actorUrl}/analytics/stream`);

eventSource.addEventListener('metric', (e) => {
  const metric = JSON.parse(e.data);

  // Store in SupaHooks' own TimescaleDB
  await supabase.from('webhook_metrics').insert({
    customer_id: customerId,
    webhook_id: metric.webhookId,
    latency_ms: metric.latencyMs,
    status_code: metric.statusCode,
    captured_at: metric.timestamp,
  });
});
```

### Grafana Dashboard

```yaml
# Prometheus scrape config (requires /analytics/prometheus endpoint)
scrape_configs:
  - job_name: "webhook-debugger"
    static_configs:
      - targets: ["actor-url:8080"]
    metrics_path: /analytics/prometheus
```

### NPM Package Usage

```javascript
const debugger = new WebhookDebugger({
  analytics: {
    enabled: true,
    onRequest: async (event) => {
      await fetch('https://supahooks.io/api/ingest', {
        method: 'POST',
        body: JSON.stringify(event),
      });
    },
  },
});
```

---

## Testing

- [ ] Unit: AnalyticsCollector aggregation logic
- [ ] Unit: Timeseries bucketing for all intervals
- [ ] Integration: SSE stream connection handling
- [ ] Integration: Hook callbacks fire correctly
- [ ] E2E: External client consuming stream

---

## Documentation

- [ ] API reference: `/analytics/*` endpoints
- [ ] Integration guide: "Building a Dashboard with SupaHooks"
- [ ] NPM package: Update README with analytics hooks

---

## Rollout

1. Feature-flag behind `analyticsEnabled`
2. Ship REST endpoints first (v3.x-beta)
3. Add SSE stream (v3.x)
4. Document external integration patterns
