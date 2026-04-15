# 🌉 Low-Code Bridge Playbook: Zapier, Make, and n8n

Use Webhook Debugger as a buffer between a source system and a workflow tool when you need better observability, safer forwarding, and optional schema-based gating.

## ⚠️ Important Behavior to Know First

- The built-in forwarder always sends `POST` requests to `forwardUrl`.
- Forwarding failures are recorded as separate system log entries.
- `jsonSchema` is a hard gate. Invalid payloads get a `400` response before normal webhook log persistence, so they are not preserved as standard captured events.

That means the safest rollout is usually **observe first**, then **enforce later**.

## 📋 Phase 1: Observe Mode

Start here when you still need to learn the payload shape.

```json
{
  "urlCount": 1,
  "retentionHours": 48,
  "authKey": "automation-bridge-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "forwardUrl": "https://hooks.zapier.com/hooks/catch/11111/aaaaa/",
  "forwardHeaders": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"received\":true}"
}
```

## 📋 Phase 2: Enforce Mode

Add a schema only after you know the source payload is stable enough to gate.

```json
{
  "urlCount": 1,
  "retentionHours": 48,
  "authKey": "automation-bridge-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "forwardUrl": "https://hooks.zapier.com/hooks/catch/11111/aaaaa/",
  "forwardHeaders": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"received\":true}",
  "jsonSchema": "{\"type\":\"object\",\"required\":[\"financial_status\"],\"properties\":{\"financial_status\":{\"const\":\"paid\"}}}"
}
```

## 🧭 Safer Alternatives to Hard Gating

If you still need full visibility into everything the source sends, use `customScript` to normalize or annotate the event instead of rejecting it with `jsonSchema`.

## 🔎 Investigation Queries That Match the Current API

- Forwarded source events with a parsed field:

```text
GET /logs?webhookId=<your-webhook-id>&body.financial_status=paid
```

- Downstream bridge failures:

```text
GET /logs?webhookId=<your-webhook-id>&method=SYSTEM
```

- Header-based routing issues:

```text
GET /logs?webhookId=<your-webhook-id>&headers.x-shopify-topic=orders/create
```

## 🔍 Common Low-Code Pain Points

| Pain point | What the current code supports |
| :--------- | :----------------------------- |
| Mapping nested JSON into Zapier or Make | Capture the real payload first with `enableJSONParsing`, then copy exact fields from `/logs` into your workflow tool. |
| Silent downstream failures | Query `method=SYSTEM` to surface forwarding error entries created after the sender already got a successful response. |
| Wanting to reject noise without losing observability | Do not start with `jsonSchema`. Sample the traffic first, then turn the schema on once you know the event shape is stable. |

## 🔄 Recommended Workflow

1. Run in observe mode and collect a representative sample.
2. Build or fix your Zap, Make scenario, or n8n flow using the captured payloads.
3. Add `jsonSchema` only after your mapping is stable.
4. If the downstream tool fails later, replay the captured event:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fhooks.zapier.com%2Fhooks%2Fcatch%2F11111%2Faaaaa%2F"
```
