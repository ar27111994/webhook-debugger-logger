# 🛍️ Shopify Launch Week Playbook

Ensure your store's inventory and order fulfillment hooks are rock-solid during high-traffic launch windows.

## 🚀 One-Click Configuration

**[Launch Webhook Debugger with Shopify Presets](https://console.apify.com/actors/ar27111994/webhook-debugger-logger?input=%7B%22defaultResponseCode%22%3A200%2C%22forwardHeaders%22%3Atrue%2C%22maskSensitiveData%22%3Atrue%7D)**

## 📋 Recommended Input (JSON)

```json
{
  "urlCount": 2,
  "retentionHours": 72,
  "forwardUrl": "https://your-dev-environment.com/api/shopify",
  "forwardHeaders": true,
  "maskSensitiveData": true
}
```

## 🔍 Common Shopify Error Patterns

| Error Signal                    | Description                                        | Solution                                                               |
| :------------------------------ | :------------------------------------------------- | :--------------------------------------------------------------------- |
| `X-Shopify-Hmac-Sha256 Invalid` | Signature check failed on your receiver.           | Ensure `forwardHeaders` is enabled to pass HMAC headers.               |
| `429 Too Many Requests`         | Shopify is sending hooks too fast for your server. | Use the **Automated Pipe** as a buffer, then process at your own pace. |
| `Duplicate Events`              | Shopify retries hooks if response isn't 200/201.   | Ensure `defaultResponseCode` is set to 200.                            |

## 🛠️ Typical Workflow

1. **Bridge**: Use the Actor as a bridge between Shopify and your local machine.
2. **Persistence**: Set `retentionHours` to 72 to keep logs available throughout the launch weekend.
3. **Validation**: Use `customScript` to flag orders with specific tags for easier inspection.
