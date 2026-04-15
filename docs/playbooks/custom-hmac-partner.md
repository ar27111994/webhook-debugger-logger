# Custom HMAC Partner Integration Playbook

Use this playbook when a partner system signs webhooks with a non-standard header, custom timestamp header, or a different signature encoding than the built-in Stripe, Shopify, GitHub, or Slack profiles.

## Quick Setup (Manual)

1. Open [Webhook Debugger on Apify Store](https://apify.com/ar27111994/webhook-debugger-logger).
2. Open the **Input** tab.
3. Paste the JSON configuration below and replace the partner-specific values.

## Recommended Quick-Start (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 24,
  "authKey": "partner-debug-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "signatureVerification": {
    "provider": "custom",
    "secret": "replace_with_shared_secret",
    "headerName": "X-Partner-Signature",
    "timestampKey": "X-Partner-Timestamp",
    "algorithm": "sha256",
    "encoding": "hex",
    "tolerance": 300
  },
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"accepted\":true}",
  "forwardUrl": "https://staging.example.com/partner/webhooks",
  "forwardHeaders": true,
  "alerts": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/AAA/BBB/CCC"
    }
  },
  "alertOn": ["signature_invalid", "5xx"]
}
```

## What This Matches in the Current Code

- `provider: "custom"` requires `headerName` and a shared secret.
- `timestampKey` is optional, but once configured it is enforced and checked against `tolerance`.
- `sha256` with `hex` is the default path, and the current test suite also verifies `sha1` and `base64` combinations.
- Verification happens before normal request handling finishes, so a signature failure is visible directly on the captured event.

## Investigation Queries That Match the Current API

- All custom-provider signature failures:

```text
GET /logs?webhookId=<your-webhook-id>&signatureProvider=custom&signatureValid=false
```

- Requests carrying the partner signature header:

```text
GET /logs?webhookId=<your-webhook-id>&headers.x-partner-signature=
```

- Timestamp-related failures:

```text
GET /logs?webhookId=<your-webhook-id>&signatureError=timestamp
```

## Common Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| Missing custom header error | `headerName` does not match the real incoming header | Compare the captured headers and update `headerName` exactly. |
| Missing timestamp error | `timestampKey` was configured, but the sender does not actually send it | Remove `timestampKey` or fix the sender contract. |
| Signature mismatch | Wrong secret, wrong algorithm, or wrong encoding (`hex` vs `base64`) | Align the actor config with the partner's signing documentation and retest. |

## Recommended Workflow

1. Start with the partner's test environment and point it at a fresh generated webhook ID.
2. Inspect the raw captured headers and confirm the real signature and timestamp header names.
3. Enable custom verification and watch `/logs?signatureValid=false` until the mismatch disappears.
4. If the partner expects your staging receiver to validate the same headers, keep `forwardHeaders: true`.
5. Replay a known-good event after you fix the downstream integration:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fstaging.example.com%2Fpartner%2Fwebhooks"
```
