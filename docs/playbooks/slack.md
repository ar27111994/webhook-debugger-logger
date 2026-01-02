# 💬 Slack App & Bot Playbook

Accelerate your Slack app development by inspecting complex Block Kit payloads and verifying interactive component responses.

## 🚀 Quick Setup (Manual)

1. **[Open Webhook Debugger on Apify Store](https://apify.com/ar27111994/webhook-debugger-logger?utm_campaign=slack_bot)**
2. Navigate to the **Input** tab.
3. **Copy & Paste** the JSON from the section below into the JSON editor.

## 📋 Recommended Quick-Start (JSON)

Copy the JSON below and paste it into the **Input** tab in Apify Console:

```json
{
  "authKey": "slack-bot-key",
  "enableJSONParsing": true,
  "defaultResponseCode": 200,
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
    "authKey": "slack-bot-test",
    "enableJSONParsing": true,
    "defaultResponseCode": 200
  }'
```

## 🧠 Advanced: Interactive Block Debugging

Slack's interactive components (buttons, menus) send massive payloads that can be hard to mock.

1. **Live Inspection**: Point your "Interactive Components" URL to the Actor.
2. **Dynamic Responses**: Use `customScript` to return specific JSON (e.g., `{"replace_original": "true"}`) to test how Slack updates your message in real-time.

## 🔍 Common Slack Error Patterns

| Error Signal       | Description                                                | Solution                                                                                                         |
| :----------------- | :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `dispatch_failed`  | Slack didn't get a 200 OK within 3 seconds.                | Ensure the Actor is in **Standby Mode** for sub-10ms responses.                                                  |
| `Missing block_id` | Your Block Kit JSON is malformed.                          | Inspect the raw body in the Actor dataset; the Actor's **JSON Parsing** handles nested structures automatically. |
| `ssl_required`     | Slack requires HTTPS for all endpoints.                    | The Actor's generated URLs are **HTTPS by default**, satisfying Slack's security policy.                         |
| `Invalid Response` | Slack expects specific responses for interactive triggers. | Use `customScript` to return the exact JSON Slack expects.                                                       |

## 🛠️ Typical Workflow

1. **Interactive Test**: Point your Slack App's "Interactivity & Shortcuts" URL to the Actor.
2. **Payload Inspection**: Click a button in Slack and see the massive JSON payload arrive in the Actor's **SSE Live View**.
3. **Drafting**: Use the captured payload as a template for your real backend logic.
4. **Automation**: Once your logic is ready, switch the Actor to **Forwarding Mode** to bridge Slack to your local dev environment.
