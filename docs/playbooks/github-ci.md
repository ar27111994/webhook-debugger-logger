# GitHub App & CI Webhook Playbook

Use this playbook to inspect GitHub App, repository, and CI/CD webhook deliveries, validate `X-Hub-Signature-256`, and replay a captured delivery into staging after you fix downstream automation.

## Quick Setup (Manual)

1. Open [Webhook Debugger on Apify Store](https://apify.com/ar27111994/webhook-debugger-logger).
2. Open the **Input** tab.
3. Paste the JSON configuration below.

## Recommended Quick-Start (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 48,
  "authKey": "github-debug-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "signatureVerification": {
    "provider": "github",
    "secret": "replace_with_github_webhook_secret"
  },
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"received\":true}",
  "forwardUrl": "https://staging.example.com/github/webhooks",
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

## What This Matches in the Current Code

- GitHub verification uses `X-Hub-Signature-256` with the required `sha256=` prefix.
- Verification runs against the preserved raw request body, so signatures stay valid even when `enableJSONParsing` is turned on.
- GitHub JSON payloads become queryable objects after parsing.
- Replay preserves the original captured method and payload, while ordinary forwarding always posts to `forwardUrl`.

## Investigation Queries That Match the Current API

- Deliveries for a specific GitHub event:

```text
GET /logs?webhookId=<your-webhook-id>&headers.x-github-event=push
```

- A specific delivery ID from GitHub's webhook UI:

```text
GET /logs?webhookId=<your-webhook-id>&headers.x-github-delivery=<delivery-id>
```

- Failed signature verification:

```text
GET /logs?webhookId=<your-webhook-id>&signatureValid=false
```

- Downstream failures after ingress succeeded:

```text
GET /logs?webhookId=<your-webhook-id>&method=SYSTEM
```

## Common Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| `signatureValid=false` | Wrong webhook secret or missing `sha256=` prefix in the incoming header | Re-check the GitHub webhook secret and inspect the captured raw request. |
| Missing expected `action` field | The event type does not include the payload shape your workflow assumed | Filter by `headers.x-github-event` first, then inspect the parsed body for that event family. |
| `method=SYSTEM` entries | GitHub reached the actor, but forwarding to your staging or automation bridge failed later | Fix the downstream target, then replay the original delivery by log ID. |

## Recommended Workflow

1. Point your GitHub App or repository webhook at the generated `/webhook/:id` URL.
1. Use `/info` to confirm the active webhook ID and management endpoints.
1. Filter captured traffic by `headers.x-github-event` and `headers.x-github-delivery` while testing workflow runs.
1. Replay a specific captured delivery to staging after your fix:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fstaging.example.com%2Fgithub%2Fwebhooks"
```

1. Use `responseDelayMs` or a temporary `?__status=500` on the generated webhook URL if you need to drill failure handling before production changes.
