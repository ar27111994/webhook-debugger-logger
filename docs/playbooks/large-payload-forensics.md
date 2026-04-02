# Large Payload & Binary Forensics Playbook

Use this playbook when you are debugging oversized JSON bodies, binary webhook uploads, or webhook payloads that are too large to keep inline in the normal log dataset.

## Recommended Quick-Start (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 72,
  "authKey": "payload-forensics-key",
  "maxPayloadSize": 10485760,
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "redactBodyPaths": [
    "body.customer.email"
  ],
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"received\":true}",
  "replayMaxRetries": 3,
  "replayTimeoutMs": 15000
}
```

## What This Matches in the Current Code

- Text-like payloads are stored as UTF-8 strings.
- Binary payloads are stored as base64 and tagged with `bodyEncoding` in log detail views.
- Large payloads above the KVS offload threshold are replaced in normal log views with an offload marker object.
- `/logs/:logId/payload` hydrates the full stored payload, and replay also hydrates offloaded payloads automatically.

## Investigation Queries That Match the Current API

- Large events by size:

```text
GET /logs?webhookId=<your-webhook-id>&size[gte]=1000000
```

- Binary or file-like traffic by content type:

```text
GET /logs?webhookId=<your-webhook-id>&contentType=application/pdf
```

- Full payload retrieval for an offloaded event:

```text
GET /logs/<log-id>/payload
```

## What to Inspect First

1. `contentType` to understand whether the payload should have been parsed as JSON, text, or binary.
2. `size` to determine whether the payload likely crossed the KVS offload threshold.
3. `/logs/:logId` for `bodyEncoding` and the inline offload marker.
4. `/logs/:logId/payload` for the full raw payload.

## Common Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| Inline body contains an offload marker object | The payload was too large for inline dataset storage | Fetch `/logs/:logId/payload` before diffing or replaying the event. |
| Binary content is unreadable in the normal log row | The body was stored as base64 | Inspect `bodyEncoding` in the log detail, then use the payload route for the raw content. |
| Replay looks incomplete for a large event | You replayed based on the inline row only | Use the built-in replay route so the actor hydrates the full KVS-backed payload automatically. |

## Recommended Workflow

1. Capture the event with a large enough `maxPayloadSize` to avoid immediate request rejection.
2. Query by `size[gte]` or `contentType` to locate the affected request quickly.
3. Pull `/logs/:logId/payload` for the full body.
4. Replay the exact captured payload to a test receiver if you need to validate parser or storage changes:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fstaging.example.com%2Fpayload-test"
```
