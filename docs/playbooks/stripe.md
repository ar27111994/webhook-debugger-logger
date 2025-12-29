# 💳 Stripe Webhook Hardening Playbook

Use this playbook to verify signatures, inspect event payloads, and re-run payment fulfillment logic without exhausting your Stripe test event limits.

## 🚀 Quick Setup (Manual)

1. **[Open Webhook Debugger on Apify Store](https://apify.com/ar27111994/webhook-debugger-logger)**
2. Navigate to the **Input** tab.
3. **Copy & Paste** the JSON from the section below into the JSON editor.

## 📋 Recommended Quick-Start (JSON)

Copy the JSON below and paste it into the **Input** tab in Apify Console:

```json
{
  "authKey": "stripe-live-verification",
  "allowedIps": ["3.18.12.63"],
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"received\": true}",
  "maskSensitiveData": true,
  "jsonSchema": "{\"type\":\"object\",\"required\":[\"type\",\"data\"]}"
}
```

## 🛠️ Programmatic Run (API)

If you already have an Apify Token, you can trigger this setup via `curl`:

```bash
curl --request POST \
  --url https://api.apify.com/v2/acts/ar27111994~webhook-debugger-logger/run-sync?token=YOUR_API_TOKEN \
  --header 'Content-Type: application/json' \
  --data '{
    "authKey": "stripe-live-verification",
    "maskSensitiveData": true,
    "defaultResponseCode": 200
  }'
```

## 🧠 Advanced Edge Cases

- **Idempotency Testing**: Stripe retries failed hooks with the same `id`. Use the Actor's **SSE Live View** to verify your backend doesn't create duplicate orders when the Actor forwards the same hook twice.
- **Race Conditions**: Use **Custom Latency (Simulation)** to delay responses by 5s. This helps you identify if your frontend is polling for updates before your webhook handler finishes processing.

## 🔍 Common Stripe Error Patterns

| Error Signal                 | Description                                         | Solution                                                                                            |
| :--------------------------- | :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `status: 400`                | Invalid JSON or missing required fields.            | The Actor's `jsonSchema` filter ensures your backend only receives valid Stripe events.             |
| `Signature Invalid`          | Headers were modified or `forwardHeaders` is false. | Enable `forwardHeaders`; the Actor passes the `Stripe-Signature` exactly as received.               |
| `checkout.session.completed` | You didn't complete your test checkout in time.     | Use the **Replay API** to resend the exact payload once you're ready to test your expiration logic. |

## 🛠️ Typical Workflow

1. **Set up**: Point your Stripe Dashboard (Webhooks) to the generated Actor URL.
2. **Inspect**: Use `checkout.session.completed` to verify metadata (e.g., `client_reference_id`) is correctly passed.
3. **Stress Test**: Use Stripe's "Send test webhook" button to fire multiple events and verify the Actor's **sub-10ms response** prevents Stripe timeout retries.
4. **Replay**: Resend exact payloads using `/replay/:id` to iterate on your backend without creating new Stripe objects.
