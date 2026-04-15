# 💰 Revenue Recovery Playbook: Stripe and Shopify

Use this playbook during high-burst launches when you need a durable buffer between the provider and your reconciliation endpoint, plus a reliable way to replay missed events after you patch downstream failures.

## 📋 Recommended Recovery Profile (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 168,
  "authKey": "recovery-mode-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "signatureVerification": {
    "provider": "stripe",
    "secret": "whsec_replace_me"
  },
  "forwardUrl": "https://api.example.com/webhooks/reconcile",
  "forwardHeaders": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"status\":\"buffered\"}",
  "replayMaxRetries": 5,
  "replayTimeoutMs": 15000,
  "alerts": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/AAA/BBB/CCC"
    }
  },
  "alertOn": ["signature_invalid", "5xx"]
}
```

If the launch is Shopify-based, change `signatureVerification.provider` to `shopify` and replace the secret accordingly.

## ✅ What the Current Implementation Actually Logs

- The original provider event is stored as a normal webhook log entry.
- If forwarding to your reconciliation service fails later, the actor writes a separate system log entry with `method=SYSTEM`, `statusCode=500`, and an `originalEventId` reference.
- Replay can hydrate payloads that were offloaded to KVS because they were too large for inline storage.

## 🔎 Investigation Queries That Match the Current API

- Original provider deliveries:

```text
GET /logs?webhookId=<your-webhook-id>&method=POST
```

- Downstream reconciliation failures:

```text
GET /logs?webhookId=<your-webhook-id>&method=SYSTEM
```

- Signature failures during peak traffic:

```text
GET /logs?webhookId=<your-webhook-id>&signatureValid=false
```

- Large event body retrieval:

```text
GET /logs/<log-id>/payload
```

## 🔍 Failure Modes to Watch Closely

| Failure mode | How it appears in the current system | Recovery step |
| :----------- | :----------------------------------- | :------------ |
| Downstream API outage | Separate `method=SYSTEM` log entries after the original webhook succeeded | Fix the receiver, then replay the original event by its captured log ID. |
| Signature drift | `signatureValid=false` on the captured event | Verify the provider secret before retrying anything downstream. |
| Large payload truncation concerns | Body is replaced with an offload marker in normal log views | Use `/logs/:logId/payload` before you replay or diff the event. |

## 🔄 Recommended Recovery Workflow

1. Point the provider to the actor before the launch starts.
2. Keep the actor running for the full recovery window by setting `retentionHours` high enough for your team.
3. Query `method=SYSTEM` to isolate forwarding failures instead of assuming the provider-facing `statusCode` tells the whole story.
4. Fix the downstream service.
5. Replay the original captured event:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fapi.example.com%2Fwebhooks%2Freconcile"
```
