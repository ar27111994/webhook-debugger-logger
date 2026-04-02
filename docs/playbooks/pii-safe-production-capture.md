# PII-Safe Production Capture Playbook

Use this playbook when you need production-grade webhook visibility without turning the actor into a raw dump of secrets, personal data, or internal credentials.

## Recommended Quick-Start (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 24,
  "authKey": "production-capture-key",
  "allowedIps": [
    "198.51.100.0/24",
    "203.0.113.10"
  ],
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "redactBodyPaths": [
    "body.customer.email",
    "body.customer.phone",
    "body.payment_method.card.last4",
    "body.metadata.internal_note"
  ],
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"accepted\":true}",
  "forwardHeaders": false,
  "replayMaxRetries": 2,
  "replayTimeoutMs": 10000
}
```

## What This Matches in the Current Code

- `authKey` is enforced on both webhook ingest and management endpoints.
- `allowedIps` is checked against the resolved request IP and supports CIDR ranges.
- `maskSensitiveData` masks sensitive headers in stored logs.
- `redactBodyPaths` redacts only the logged copy of the body; the middleware clones before redaction so forwarding still uses the original request body.

## Operational Rules for Safer Production Use

- Prefer `Authorization: Bearer <authKey>` for operator access. Query-parameter auth still exists, but the code treats it as the riskier fallback and logs a warning.
- Keep `retentionHours` as short as your investigation window allows.
- Leave `forwardHeaders` off unless the downstream target explicitly needs provider-specific signature headers.
- Use provider-specific `signatureVerification` whenever possible instead of relying only on IP allow lists.

## Investigation Queries That Match the Current API

- Traffic from a specific source IP:

```text
GET /logs?webhookId=<your-webhook-id>&remoteIp=203.0.113.10
```

- Signature failures in production:

```text
GET /logs?webhookId=<your-webhook-id>&signatureValid=false
```

- Suspicious 4xx outcomes:

```text
GET /logs?webhookId=<your-webhook-id>&statusCode[gte]=400&statusCode[lt]=500
```

## Common Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| Unexpected `403 Forbidden` on ingress | The sender IP is outside `allowedIps` | Confirm the real source range before widening the allow list. |
| Sensitive headers still visible to downstream | `forwardHeaders` is enabled because the receiver depends on them | Decide whether that downstream receiver really needs the headers, because log masking does not change the forwarded request. |
| A redacted field is still visible in the replay target | `redactBodyPaths` only changes the stored log copy | Use downstream-side sanitization too if you need privacy guarantees beyond operator logs. |

## Recommended Workflow

1. Start with `maskSensitiveData: true` and an explicit `redactBodyPaths` list.
2. Protect the actor with `authKey` and, if feasible, `allowedIps`.
3. Use `/info` to confirm the active webhook ID and current payload limit.
4. Keep your investigation limited to the smallest time window and retention window you need.
5. If you must replay production traffic, review the payload route first and confirm the destination is authorized to receive the full event.
