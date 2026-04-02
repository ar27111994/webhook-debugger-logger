# Legacy Migration Playbook: Version Upgrades and Bridge Cutovers

Use this playbook when you need to compare payloads across an old and new provider or API version before cutting production traffic over.

## 📋 Recommended Migration Profile (JSON)

This profile uses multiple generated endpoints so you can keep one webhook ID per source system and compare them cleanly through `/logs`.

```json
{
  "urlCount": 2,
  "retentionHours": 72,
  "authKey": "migration-audit-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "redactBodyPaths": [
    "body.customer.email",
    "body.user.token"
  ],
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"accepted\":true}",
  "forwardUrl": "https://canary.example.com/webhooks/audit",
  "forwardHeaders": true
}
```

## 🧩 Optional Custom Signature Profile

If the migrating sender uses a non-standard HMAC header, the current code supports a custom verifier.

```json
{
  "signatureVerification": {
    "provider": "custom",
    "secret": "shared-secret",
    "headerName": "x-partner-signature",
    "timestampKey": "x-partner-timestamp",
    "algorithm": "sha256",
    "encoding": "hex",
    "tolerance": 300
  }
}
```

## ✅ What This Matches in the Current Code

- `urlCount` can generate up to 50 active webhook IDs, so you can dedicate one endpoint per source system or rollout stage.
- `/info` returns the active webhook IDs, which makes it easy to map “old provider” and “new provider” traffic explicitly.
- JSON payloads become queryable objects when `enableJSONParsing` is enabled.
- The standard forwarder always sends `POST` to `forwardUrl`, so if HTTP method parity matters during migration validation, use replay instead of relying only on forwarding.

## 🔎 Comparison Queries That Match the Current API

- Old provider stream:

```text
GET /logs?webhookId=<old-webhook-id>
```

- New provider stream:

```text
GET /logs?webhookId=<new-webhook-id>
```

- Field rename or shape drift after JSON parsing:

```text
GET /logs?webhookId=<new-webhook-id>&body.customer_id=
```

- Header parity checks:

```text
GET /logs?webhookId=<new-webhook-id>&headers.x-signature=
```

## 🔍 Migration Safety Checks

| Risk | How to inspect it with the current actor |
| :--- | :--------------------------------------- |
| Field renames | Compare `/logs` results by webhook ID and inspect nested `body.*` fields. |
| Type mismatches | Keep `enableJSONParsing` on and compare whether a field is still string-like or now numeric or object-shaped. |
| Large payload drift | Use `/logs/:logId/payload` so offloaded payloads are compared in full, not just by marker objects. |
| Header contract changes | Query `headers.*` values directly from `/logs` for the new source ID. |

## 🔄 Recommended Workflow

1. Generate at least two webhook IDs.
2. Use `/info` to map one ID to the old provider and one to the new provider.
3. Capture a representative sample from both sources.
4. Diff the resulting logs or exported dataset.
5. Replay a specific captured event to staging when you need to preserve the original HTTP method and payload:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fstaging.example.com%2Fwebhooks%2Faudit"
```
