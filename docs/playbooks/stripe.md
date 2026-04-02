# 💳 Stripe Webhook Hardening Playbook

Use this playbook when you need to validate Stripe signatures, inspect captured payloads, forward events into a dev or staging receiver, and replay specific deliveries after you fix downstream code.

## 🚀 Quick Setup (Manual)

1. Open [Webhook Debugger on Apify Store](https://apify.com/ar27111994/webhook-debugger-logger).
2. Open the **Input** tab.
3. Paste one of the JSON configurations below.

## 📋 Recommended Quick-Start (JSON)

This profile uses the current code-backed Stripe features: raw-body signature verification, JSON parsing, replay controls, header-preserving forwarding, and alerting on signature failures or 5xx responses.

```json
{
  "urlCount": 1,
  "retentionHours": 72,
  "authKey": "stripe-debug-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "redactBodyPaths": [
    "body.data.object.customer_email",
    "body.data.object.metadata.internal_note"
  ],
  "signatureVerification": {
    "provider": "stripe",
    "secret": "whsec_replace_me",
    "tolerance": 300
  },
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"received\":true}",
  "forwardUrl": "https://staging.example.com/webhooks/stripe",
  "forwardHeaders": true,
  "replayMaxRetries": 3,
  "replayTimeoutMs": 10000,
  "alerts": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/AAA/BBB/CCC"
    }
  },
  "alertOn": ["signature_invalid", "5xx"]
}
```

> [!IMPORTANT]
> **Verify Stripe IPs (`allowedIps`)**: Stripe frequently updates their webhook IP ranges. Always consult the **Official Stripe Webhook IP Documentation**: [IP Addresses](https://docs.stripe.com/ips#ip-addresses?utm_campaign=stripe_hardening) and [Webhook Notifications](https://docs.stripe.com/ips#webhook-notifications?utm_campaign=stripe_hardening) to ensure your whitelist (if specified) is up to date.

## 🛠️ Optional Hardening

- Prefer `signatureVerification.provider = "stripe"` over a static Stripe IP list. The code path verifies the signed raw request body directly, which is more stable than copying provider IP ranges into `allowedIps`.
- Use `allowedIps` only if you also maintain Stripe's published IP ranges outside this actor.
- Keep `forwardHeaders: true` if your downstream receiver also validates `Stripe-Signature`.

## 🔎 Investigation Queries That Match the Current API

- Failed signature checks:

```text
GET /logs?webhookId=<your-webhook-id>&signatureValid=false
```

- A specific Stripe event type after JSON parsing:

```text
GET /logs?webhookId=<your-webhook-id>&body.type=checkout.session.completed
```

- Full payload when the actor offloaded a large body to KVS:

```text
GET /logs/<log-id>/payload
```

## 🧪 Runtime Knobs Worth Using

- Set `responseDelayMs` to simulate slow acknowledgements and observe Stripe retry behavior.
- Append `?__status=500` to the generated webhook URL to force a temporary failure without changing the saved actor config.
- Use `customScript` if you need to mutate the stored event or the immediate response. The current middleware supports `event.statusCode`, `event.responseBody`, and `event.responseHeaders` overrides.

## 🔍 Common Stripe Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| `signatureValid=false` | Wrong signing secret, modified raw body, or stale timestamp tolerance | Verify the `whsec_...` secret and inspect the captured request before any downstream transformation. |
| 5xx sender response | Your test profile is intentionally simulating a failure, or your custom script changed `event.statusCode` | Remove the forced status or replay a healthy event after the downstream fix is deployed. |
| Forwarding failures | The upstream webhook was accepted, but the downstream bridge failed later | Query `GET /logs?webhookId=<id>&method=SYSTEM` to inspect separate forwarding error entries. |

## 🔄 Recommended Workflow

1. Point Stripe to the generated `/webhook/:id` URL.
2. Use `/info` to confirm the active webhook ID and current payload limit.
3. Inspect live captures with `/logs` and `/log-stream` while Stripe sends test events.
4. Replay a specific captured event to staging after a fix:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fstaging.example.com%2Fwebhooks%2Fstripe"
```

Replay uses the original captured method and payload, hydrates large offloaded bodies automatically, and strips masked or unsafe headers before sending the request onward.
