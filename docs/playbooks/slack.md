# 💬 Slack App & Bot Playbook

Use this playbook to inspect Slack Events API traffic, verify signed requests, debug interactive payloads, and test custom immediate responses for app callbacks.

## 🚀 Quick Setup (Manual)

1. Open [Webhook Debugger on Apify Store](https://apify.com/ar27111994/webhook-debugger-logger).
2. Open the **Input** tab.
3. Paste the JSON configuration below.

## 📋 Recommended Quick-Start (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 24,
  "authKey": "slack-debug-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "signatureVerification": {
    "provider": "slack",
    "secret": "slack_signing_secret",
    "tolerance": 300
  },
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"ok\":true}",
  "defaultResponseHeaders": {
    "Content-Type": "application/json"
  },
  "forwardUrl": "https://staging.example.com/slack/events",
  "forwardHeaders": true
}
```

## ✅ What This Matches in the Current Code

- Slack request verification uses the signed raw body and timestamp headers.
- JSON payloads are auto-parsed only when Slack sends `application/json`.
- Interactive payloads sent as `application/x-www-form-urlencoded` are captured as raw text, not automatically expanded into nested JSON objects.
- `customScript` can override `event.statusCode`, `event.responseBody`, and `event.responseHeaders`, which makes it suitable for immediate Slack callback experiments.

## 🧪 Interactive Response Example

If you want Slack interactivity requests to receive a custom JSON response body, use a script like this:

```javascript
event.responseHeaders = { "Content-Type": "application/json" };
event.responseBody = { text: "Handled by the sandbox" };
```

## 🔎 Investigation Queries That Match the Current API

- Signature failures:

```text
GET /logs?webhookId=<your-webhook-id>&signatureValid=false
```

- Slack Events API JSON traffic:

```text
GET /logs?webhookId=<your-webhook-id>&body.type=event_callback
```

- Slack interactivity payloads captured as form data:

```text
GET /logs?webhookId=<your-webhook-id>&body=payload%3D
```

## 🔍 Common Slack Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| `signatureValid=false` | Wrong signing secret or timestamp outside tolerance | Verify the Slack signing secret and check server clock skew. |
| `dispatch_failed` | Slack did not receive a fast enough 2xx | Keep the immediate actor response lightweight and move heavy work behind forwarding or replay. |
| Raw `payload=` body instead of nested JSON | Slack interactivity was sent as form-encoded data | Inspect the raw body string or forward it to app code that already knows how to decode Slack interactivity payloads. |

## 🔄 Recommended Workflow

1. Point either the Events API URL or the Interactivity URL at the generated actor webhook.
2. Use `/logs` and `/log-stream` to capture both the headers and the raw callback body.
3. Add a `customScript` when you want to prototype an immediate response body without deploying your real Slack backend.
4. Turn on forwarding after you have confirmed the payload shape you want your real app to consume.
