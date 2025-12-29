# 🛍️ Shopify Launch Week Playbook

Ensure your store's inventory and order fulfillment hooks are rock-solid during high-traffic launch windows.

## 🚀 Quick Setup (One-Click)

1. **[Open Webhook Debugger Input Tab](https://console.apify.com/actors/ar27111994~webhook-debugger-logger#/input)**
2. **Copy & Paste** the JSON from the section below.

## 📋 Recommended Quick-Start (JSON)

Copy the JSON below and paste it into the **Input** tab in Apify Console:

```json
{
  "urlCount": 2,
  "retentionHours": 72,
  "forwardUrl": "https://your-dev-environment.com/api/shopify",
  "forwardHeaders": true,
  "maskSensitiveData": true
}
```

## 🛠️ Programmatic Run (API)

Trigger this setup for your dev environment via `curl`:

```bash
curl --request POST \
  --url https://api.apify.com/v2/acts/ar27111994~webhook-debugger-logger/run-sync?token=YOUR_API_TOKEN \
  --header 'Content-Type: application/json' \
  --data '{
    "forwardUrl": "https://your-dev-server.ngrok.io/webhooks/shopify",
    "forwardHeaders": true,
    "retentionHours": 72
  }'
```

## 🧠 Advanced: Inventory Sync & Retries

Shopify is aggressive with webhook retries. To test your idempotency logic:

1. Use **Custom Latency** to delay responses by 10s, forcing Shopify to retry.
2. Verify in the **SSE Live View** that your backend handles the second (duplicate) hook without creating double orders.

## 🔍 Common Shopify Error Patterns

| Error Signal                    | Description                                         | Solution                                                                                                         |
| :------------------------------ | :-------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `X-Shopify-Hmac-Sha256 Invalid` | Signature check failed on your receiver.            | Ensure `forwardHeaders` is enabled to pass HMAC headers.                                                         |
| `429 Too Many Requests`         | Shopify is sending hooks too fast for your server.  | Use the **Automated Pipe** as a buffer; the Actor handles the incoming burst and forwards at your server's pace. |
| `Webhook Delivery Failure`      | Shopify disables webhooks after 19 failed attempts. | Set `defaultResponseCode` to 200 immediately to stay in Shopify's good graces while you fix your app.            |

## 🛠️ Typical Workflow

1. **Bridge**: Use the Actor as a bridge between Shopify and your local machine.
2. **Persistence**: Set `retentionHours` to 72 to keep logs available throughout the whole launch weekend.
3. **Validation**: Use `customScript` to flag orders with specific tags (e.g., `high_value`) for priority inspection.
