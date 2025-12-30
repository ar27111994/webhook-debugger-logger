# 🌉 Legacy Migration Playbook: Version Upgrades & Bridges

Mitigate risk during API version upgrades or provider migrations (e.g., migrating from SendGrid to Postmark). Use the Webhook Debugger to compare raw payloads from two sources side-by-side without breaking your production logic.

## 🚀 The Scenario: "The Risky Upgrade"

Upgrading an API version often introduces breaking changes in the JSON structure. If you switch your production endpoint immediately, any slight mismatch in field names (e.g., `user_id` vs `customer_id`) will crash your ingestion logic.

## 📋 Recommended Quick-Start (JSON)

Copy this into the **Input** tab in Apify Console to set up your migration bridge:

```json
{
  "authKey": "migration-audit-v1",
  "enableJSONParsing": true,
  "maskSensitiveData": false,
  "defaultResponseCode": 200,
  "forwardUrl": "https://your-canary-api.com/webhooks/audit",
  "forwardHeaders": true
}
```

## 🛠️ Comparison Strategy

- **Shadow Traffic**: Configure your _new_ API provider (or the _new_ version) to send traffic to the Actor while your _old_ version continues hitting your production server.
- **Side-by-Side Audit**: Use the Actor's **Dataset CSV Export** to compare the raw JSON bodies of the old vs. new versions.
- **Header Parity**: Verify if the new provider sends the same security headers (e.g., `X-Signature`) required by your existing validation logic.

## 🔍 Migration "Safety Checks"

| Risk Factor        | Comparison Method                                    | Solution                                                                                      |
| :----------------- | :--------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| **Field Renaming** | Set the Actor as the endpoint for the _new_ version. | Check if nested keys like `shipping_address` have changed to `destination`.                   |
| **Type Mismatch**  | Enable `enableJSONParsing`.                          | Verify if a field that was previously a `String` (e.g., `"123"`) is now an `Integer` (`123`). |
| **Latency Drift**  | Observe the SSE Live View timestamps.                | If the new provider is significantly slower, your backend might need higher timeouts.         |

## 🔄 The "Canary" Workflow

1. **Bridge**: Point the new API provider to the Actor.
2. **Observe**: Let it run for 24h to capture a representative sample of real-world payloads.
3. **Compare**: Export the dataset and run a `diff` against your existing production logs.
4. **Iterate**: Patch your backend to handle both versions (or just the new one) and use the **Replay API** to resend the captured "new" payloads to your dev server for testing.
5. **Cutover**: Once verified, point the provider directly to your production API.

```bash
# Verify the new payload against your staging server
curl -X GET "https://webhook-debugger-logger.apify.actor/replay/wh_audit/evt_new_v2?url=https://staging.your-api.com/webhook"
```
