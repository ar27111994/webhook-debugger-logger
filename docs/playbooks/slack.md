# 💬 Slack App & Bot Playbook

Accelerate your Slack app development by inspecting complex Block Kit payloads and verifying interactive component responses.

## 🚀 One-Click Configuration

**[Launch Webhook Debugger with Slack Presets](https://console.apify.com/actors/ar27111994/webhook-debugger-logger?input=%7B%22defaultResponseCode%22%3A200%2C%22enableJSONParsing%22%3Atrue%2C%22maskSensitiveData%22%3Atrue%7D)**

## 📋 Recommended Input (JSON)

```json
{
  "authKey": "slack-bot-key",
  "enableJSONParsing": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "",
  "maskSensitiveData": true
}
```

## 🔍 Common Slack Error Patterns

| Error Signal       | Description                                                | Solution                                                             |
| :----------------- | :--------------------------------------------------------- | :------------------------------------------------------------------- |
| `dispatch_failed`  | Slack didn't get a 200 OK within 3 seconds.                | Ensure the Actor is in **Standby Mode** for sub-10ms responses.      |
| `Missing block_id` | Your Block Kit JSON is malformed.                          | Inspect the raw body in the Actor dataset to find structural errors. |
| `Invalid Response` | Slack expects specific responses for interactive triggers. | Use `customScript` to return the exact JSON Slack expects.           |

## 🛠️ Typical Workflow

1. **Interactive Test**: Point your Slack App's "Interactivity & Shortcuts" URL to the Actor.
2. **Payload Inspection**: Click a button in Slack and see the massive JSON payload arrive in the Actor's Live View.
3. **Drafting**: Use the captured payload as a template for your real backend logic.
