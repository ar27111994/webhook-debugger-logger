# Incident Response & On-Call Recovery Playbook

Use this playbook when a webhook integration is failing in production and you need a fast, source-backed workflow for triage, evidence gathering, and safe replay.

## Recommended Recovery Profile (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 168,
  "authKey": "incident-response-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"buffered\":true}",
  "forwardUrl": "https://api.example.com/webhooks/reconcile",
  "forwardHeaders": true,
  "replayMaxRetries": 5,
  "replayTimeoutMs": 15000,
  "alerts": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/AAA/BBB/CCC"
    },
    "discord": {
      "webhookUrl": "https://discord.com/api/webhooks/AAA/BBB"
    }
  },
  "alertOn": ["error", "5xx", "signature_invalid"]
}
```

## What This Matches in the Current Code

- `/info`, `/logs`, `/log-stream`, `/replay`, and `/logs/:logId/payload` are management endpoints protected by the same auth model and management rate limiter.
- Alert dispatch supports Slack and Discord webhook channels.
- Forwarding failures are written as separate `method=SYSTEM` log entries after the original ingress request already succeeded.
- Replay exposes retry and timeout tuning through `replayMaxRetries` and `replayTimeoutMs`.

## First Five Queries to Run

1. Confirm active webhook IDs and current limits:

```text
GET /info
```

1. Watch live traffic while the incident is active:

```text
GET /log-stream?webhookId=<your-webhook-id>
```

1. Find downstream forwarding failures:

```text
GET /logs?webhookId=<your-webhook-id>&method=SYSTEM
```

1. Find signature failures:

```text
GET /logs?webhookId=<your-webhook-id>&signatureValid=false
```

1. Find a single request by the actor-generated request ID:

```text
GET /logs?requestId=<request-id>
```

## Common Incident Patterns

| Signal | What it usually means | Next action |
| :----- | :-------------------- | :---------- |
| `method=SYSTEM` rows with 500-level outcomes | The sender reached the actor, but the downstream target failed later | Fix the downstream target and replay the original captured event. |
| `signatureValid=false` | Secret drift, body tampering, or provider clock skew | Correct the verification config before replaying anything. |
| Repeated 4xx or 5xx sender responses | You are simulating failures with `?__status=` or the request path is rejecting traffic before normal processing | Confirm whether the failure is intentional, then inspect auth, IP restrictions, or schema validation. |

## Recommended Workflow

1. Authenticate with `Authorization: Bearer <authKey>` instead of the deprecated `?key=` query parameter.
1. Use `/info` to confirm the active webhook ID before filtering.
1. Pull the impacted event from `/logs` and, if necessary, fetch its full body via `/logs/:logId/payload`.
1. Patch the downstream service.
1. Replay the original captured event:

```bash
curl -X POST \
  -H "Authorization: Bearer <authKey>" \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fapi.example.com%2Fwebhooks%2Freconcile"
```

1. Keep `/log-stream` open during recovery so you can confirm the replayed request and any follow-on errors immediately.
