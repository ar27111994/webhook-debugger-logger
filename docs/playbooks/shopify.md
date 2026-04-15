# 🛍️ Shopify Launch Week Playbook

Use this playbook to harden Shopify order and inventory hooks during launch windows, while keeping enough observability to debug retries, HMAC failures, and downstream forwarding problems.

## 🚀 Quick Setup (Manual)

1. Open [Webhook Debugger on Apify Store](https://apify.com/ar27111994/webhook-debugger-logger).
2. Open the **Input** tab.
3. Paste the JSON configuration below.

## 📋 Recommended Quick-Start (JSON)

```json
{
  "urlCount": 2,
  "retentionHours": 72,
  "authKey": "shopify-launch-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "redactBodyPaths": [
    "body.customer.email",
    "body.billing_address.phone"
  ],
  "signatureVerification": {
    "provider": "shopify",
    "secret": "shopify_shared_secret"
  },
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"ok\":true}",
  "forwardUrl": "https://staging.example.com/webhooks/shopify",
  "forwardHeaders": true,
  "responseDelayMs": 0,
  "alerts": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/AAA/BBB/CCC"
    }
  },
  "alertOn": ["signature_invalid", "5xx"]
}
```

## ✅ What This Matches in the Current Code

- Shopify verification runs against the preserved raw request body before JSON parsing changes the payload.
- JSON payloads become queryable objects when `enableJSONParsing` is enabled.
- Forwarding happens after the actor responds, so your Shopify sender can get a fast 2xx while your downstream environment is still being debugged.
- Failed forwards are recorded as separate system log entries rather than replacing the original webhook event.

## 🔎 Investigation Queries That Match the Current API

- Valid Shopify deliveries for a specific topic:

```text
GET /logs?webhookId=<your-webhook-id>&headers.x-shopify-topic=orders/create&signatureValid=true
```

- Signature failures:

```text
GET /logs?webhookId=<your-webhook-id>&signatureValid=false
```

- Downstream forwarding failures:

```text
GET /logs?webhookId=<your-webhook-id>&method=SYSTEM
```

## 🧪 Retry and Duplicate-Delivery Testing

- Use `responseDelayMs` to simulate slow acknowledgements and watch how Shopify retries.
- Append `?__status=503` to a generated webhook URL when you want to force a temporary failure path.
- Keep `forwardHeaders: true` if your downstream receiver validates `X-Shopify-Hmac-Sha256` itself.

## 🔍 Common Shopify Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| `signatureValid=false` | Shared secret mismatch or body tampering before validation | Re-check the Shopify app secret and compare the raw captured body against the expected payload. |
| Duplicate order handling issues | Shopify retried after a delayed or failed acknowledgement | Use the captured event ID and your own order ID mapping to confirm idempotency logic. |
| `method=SYSTEM` error rows | The original webhook was accepted, but forwarding to staging failed later | Inspect the system entries, fix the downstream target, then replay the original event. |

## 🔄 Recommended Workflow

1. Use one generated webhook ID for `orders/*` traffic and the second for inventory or fulfillment traffic.
2. Confirm both IDs from `/info` before updating Shopify admin settings.
3. Query by `headers.x-shopify-topic` to isolate a noisy topic during launch.
4. Use `customScript` if you want to annotate captured orders for triage, for example by setting a flag on `event.body` or overriding the response body sent back to Shopify.
5. Replay a single captured event after a fix:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fstaging.example.com%2Fwebhooks%2Fshopify"
```
