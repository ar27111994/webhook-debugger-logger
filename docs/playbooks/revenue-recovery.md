# 💰 Revenue Recovery Playbook: Stripe & Shopify

High-burst launches (Flash Sales, Product Hunt drops) often lead to ingestion failures where your backend misses a `checkout.session.completed` hook. Use this playbook to identify exactly why payments are failing to reconcile and re-run fulfillment logic with absolute confidence.

## 🚀 The Scenario: "Launch Week Stress"

During a burst, your server might experience:

- **Rate Limits (429)**: The destination API (Zapier, Make, or your own) is overwhelmed.
- **Timeouts**: Your server takes >10s to process a complex order, causing the provider to retry.
- **Schema Drift**: A new Stripe API version changed a field name, breaking your parser.

## 📋 Configuration (JSON)

Copy this into the **Input** tab in Apify Console to set up a dedicated Revenue Recovery bridge:

```json
{
  "authKey": "recovery-mode-v2",
  "allowedIps": ["3.18.12.63", "3.130.192.160"],
  "forwardUrl": "https://your-api.com/webhooks/reconcile",
  "forwardHeaders": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"status\":\"buffered\",\"provider\":\"apify-bridge\"}",
  "maskSensitiveData": true,
  "jsonSchema": "{\"type\":\"object\",\"required\":[\"type\"]}"
}
```

## 🛠️ Performance & Pricing Strategy

- **Absorb the Burst**: Set the Actor to respond with `200 OK` in **sub-10ms**. This stops the provider (Stripe/Shopify) from retrying and potentially banning your endpoint.
- **Standby Mode**: Keep the Actor running during your 24-72h launch window. You only pay for the events you actually log ($0.01 per request), making it a cheap "insurance policy" against downtime.

## 🔍 Debugging "Invisible" Failures

| Symptom          | Detection Method                               | Solution                                                                                   |
| :--------------- | :--------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **Silent Drop**  | Check Dataset for events with `forward_error`. | If the Actor couldn't hit your API, it logs a system error. Replay that specific ID later. |
| **Partial Data** | Inspect the `body` in the SSE Live View.       | Verify if nested fields (like `metadata` or `line_items`) are missing or malformed.        |
| **Auth Failure** | Look for `401 Unauthorized`.                   | Ensure the `Stripe-Signature` is being forwarded correctly via `forwardHeaders: true`.     |

## 🔄 The Recovery Workflow

1. **Capture**: Point your provider to the Actor. It buffers high-traffic bursts and returns early success.
2. **Audit**: Filter logs by `statusCode: 429` or `method: POST` to find failed reconcile attempts.
3. **Fix**: Patch your backend code based on the raw payload stored in the Actor's dataset.
4. **Resurrect**: Use the **Replay API** to resend the exact failed payloads once your backend is ready.

```bash
# Replay a specific failed payment
curl -X GET "https://webhook-debugger-logger.apify.actor/replay/wh_reconcile/evt_99?url=https://your-api.com/fix"
```
