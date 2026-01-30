# OpenTelemetry Integration Plan

**Target Release**: v3.x (Future)  
**Priority**: Enhancement  
**Status**: Planned

---

## Overview

Add OpenTelemetry instrumentation for distributed tracing, metrics, and enhanced observability across webhook capture, forwarding, and replay flows.

## Goals

1. Trace requests end-to-end across all Actor components
2. Export telemetry to popular backends (Jaeger, Grafana, Datadog)
3. Maintain backward compatibility with existing logging
4. Zero performance impact when disabled
5. **API-first**: External clients can query and stream trace data
6. **NPM package hooks**: Programmatic access for SaaS platforms

---

## API-First Design (External Client Consumption)

> **Design Principle**: External platforms (SupaHooks, enterprise dashboards) should consume telemetry as easily as the analytics API.

### REST Endpoints

#### GET /telemetry/traces

Query recent traces with filtering.

```json
{
  "traces": [
    {
      "traceId": "abc123def456",
      "spans": [
        {
          "spanId": "span_001",
          "name": "webhook.capture",
          "startTime": "2026-01-30T10:00:00Z",
          "duration": 12,
          "attributes": { "webhook.id": "wh_abc123", "http.method": "POST" }
        },
        {
          "spanId": "span_002",
          "name": "webhook.forward",
          "startTime": "2026-01-30T10:00:00.012Z",
          "duration": 85,
          "attributes": {
            "forward.url": "https://api.example.com",
            "forward.success": true
          }
        }
      ]
    }
  ]
}
```

**Query Parameters:**

| Param         | Type   | Description                      |
| ------------- | ------ | -------------------------------- |
| `webhookId`   | string | Filter by webhook                |
| `spanName`    | string | Filter by span type              |
| `minDuration` | number | Only spans slower than this (ms) |
| `limit`       | number | Max traces to return             |

#### GET /telemetry/stream (SSE)

Real-time span events for live tracing dashboards.

```bash
event: span
data: {"traceId":"abc123","spanId":"span_001","name":"webhook.capture","duration":12}

event: span
data: {"traceId":"abc123","spanId":"span_002","name":"webhook.forward","duration":85}
```

### NPM Package Hooks

```javascript
import { WebhookDebugger } from 'webhook-debugger-logger';

const debugger = new WebhookDebugger({
  telemetry: {
    enabled: true,
    // Hook: Called for every completed span
    onSpan: (span) => {
      // Push to external tracing backend (Jaeger, Zipkin, etc.)
      sendToJaeger(span);
    },
    // Hook: Called for complete traces
    onTrace: (trace) => {
      // Store in SupaHooks' own trace storage
      await supabase.from('traces').insert(trace);
    },
  },
});
```

### Hook Signatures

```typescript
interface TelemetryHooks {
  /** Called when a span completes */
  onSpan?: (span: SpanData) => void | Promise<void>;

  /** Called when a full trace is ready (all spans finished) */
  onTrace?: (trace: TraceData) => void | Promise<void>;
}

interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: string;
  duration: number;
  status: "OK" | "ERROR";
  attributes: Record<string, string | number | boolean>;
}

interface TraceData {
  traceId: string;
  webhookId: string;
  spans: SpanData[];
  totalDuration: number;
}
```

### External Client Integration Examples

#### SupaHooks (SaaS Platform)

```javascript
// SupaHooks consuming trace stream
const eventSource = new EventSource(`${actorUrl}/telemetry/stream`);

eventSource.addEventListener('span', (e) => {
  const span = JSON.parse(e.data);

  // Store in SupaHooks' own TimescaleDB
  await supabase.from('webhook_traces').insert({
    customer_id: customerId,
    trace_id: span.traceId,
    span_name: span.name,
    duration_ms: span.duration,
    captured_at: span.startTime,
  });
});
```

#### Grafana Tempo Integration

```yaml
# Configure Actor as OTLP exporter target
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  tempo:
    endpoint: tempo:4317
```

## Implementation

### Phase 1: Core SDK Setup

#### Dependencies

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http
```

#### [NEW] src/utils/telemetry.js

```javascript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

let sdk = null;

export function initTelemetry(serviceName = "webhook-debugger") {
  if (process.env.OTEL_ENABLED !== "true") return;

  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        "http://localhost:4318/v1/traces",
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  console.log("[OTEL] Telemetry initialized");
}

export function shutdownTelemetry() {
  return sdk?.shutdown();
}
```

#### [MODIFY] src/main.js

```javascript
import { initTelemetry, shutdownTelemetry } from "./utils/telemetry.js";

// Add at top of initialize()
initTelemetry();

// Add to shutdown()
await shutdownTelemetry();
```

---

### Phase 2: Manual Instrumentation

#### Key Spans to Add

| Component              | Span Name                  | Attributes                                          |
| ---------------------- | -------------------------- | --------------------------------------------------- |
| LoggerMiddleware       | `webhook.capture`          | `webhook.id`, `http.method`, `signature.valid`      |
| ForwardingService      | `webhook.forward`          | `forward.url`, `forward.attempt`, `forward.success` |
| Replay Handler         | `webhook.replay`           | `target.url`, `original.event_id`                   |
| Signature Verification | `webhook.signature.verify` | `signature.provider`, `signature.valid`             |
| SSRF Validation        | `ssrf.validate`            | `target.host`, `ssrf.safe`                          |

#### Example: ForwardingService

```javascript
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('webhook-debugger', '2.8.7');

async forwardWebhook(event, req, options, forwardUrl) {
  return tracer.startActiveSpan('webhook.forward', async (span) => {
    span.setAttributes({
      'webhook.id': event.webhookId,
      'forward.url': forwardUrl,
      'forward.max_retries': options.maxForwardRetries,
    });

    try {
      // existing logic with attempt tracking
      span.setAttribute('forward.attempts', attempt);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

---

### Phase 3: Metrics (Optional)

#### Custom Metrics

| Metric                       | Type      | Description                    |
| ---------------------------- | --------- | ------------------------------ |
| `webhook.captured.total`     | Counter   | Total webhooks captured        |
| `webhook.forward.duration`   | Histogram | Forwarding latency             |
| `webhook.signature.failures` | Counter   | Failed signature verifications |
| `webhook.ssrf.blocked`       | Counter   | SSRF-blocked requests          |

---

## Configuration

### Input Schema Additions

```json
{
  "otelEnabled": {
    "type": "boolean",
    "title": "Enable OpenTelemetry",
    "description": "Enable distributed tracing and metrics export.",
    "default": false
  },
  "otelEndpoint": {
    "type": "string",
    "title": "OTLP Endpoint",
    "description": "OpenTelemetry collector endpoint (e.g., http://collector:4318).",
    "editor": "textfield"
  }
}
```

### Environment Variables

| Variable                      | Default            | Description            |
| ----------------------------- | ------------------ | ---------------------- |
| `OTEL_ENABLED`                | `false`            | Enable telemetry       |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | -                  | Collector URL          |
| `OTEL_SERVICE_NAME`           | `webhook-debugger` | Service name in traces |

---

## Testing

- [ ] Unit: Telemetry initialization/shutdown
- [ ] Integration: Span propagation across middleware chain
- [ ] E2E: Export to local Jaeger instance

---

## Documentation Updates

- [ ] README: Add observability section
- [ ] Input schema: Document new options
- [ ] Playbook: "Connecting to Grafana Cloud"

---

## Rollout

1. Feature-flag behind `OTEL_ENABLED`
2. Beta test with opt-in users
3. Document compatible backends
4. GA in v3.x
