# 🌉 Low-Code Bridge Playbook: Zapier & Make (Integromat)

Stop wasting money on Zapier Tasks or Make Operations for filtered-out webhooks. Use the Webhook Debugger as a "Smart Firewall" to clean, validate, and authenticate data before it touches your low-code workflows.

## 🚀 The Scenario: "Cost Optimization"

Automation platforms like Zapier often charge per successful trigger. If Shopify fires `order.updated` every time a tag changes, but you only care about `financial_status: 'paid'`, you might be wasting 90% of your task quota.

## 📋 Recommended Quick-Start (JSON)

Copy this into the **Input** tab in Apify Console to set up your cost-saving bridge:

```json
{
  "authKey": "zapier-smart-bridge",
  "forwardUrl": "https://hooks.zapier.com/hooks/catch/12345/abcde/",
  "forwardHeaders": true,
  "defaultResponseCode": 200,
  "jsonSchema": "{\"type\":\"object\",\"properties\":{\"financial_status\":{\"const\":\"paid\"}},\"required\":[\"financial_status\"]}"
}
```

## 🛠️ Performance & Pricing Strategy

- **The Filter Discount**: By using `jsonSchema` inside the Actor, events that don't match your criteria are logged in Apify but **never forwarded** to Zapier.
- **Cost Comparison**:
  - **Zapier Direct**: 10,000 events = 10,000 Tasks Used ($$$).
  - **Bridge Mode**: 10,000 events = $1.00 (Actor cost) + 1,000 Filtered Tasks ($).
- **Sub-10ms Acknowledgment**: Zapier and Make often time out if their internal processing is slow. The Actor acknowledges the provider immediately, preventing missing data due to "Trigger Timeouts."

## 🔍 Common "Low-Code" Pain Points

| Platform Pain       | Solution                                                                                                                                                                |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Nesting Hell"**  | Use the Actor to log the raw payload. Copy-paste the raw JSON into Zapier's "Test Trigger" to ensure fields are mapped correctly without firing real events.            |
| **Rate Limiting**   | Zapier can "hold" tasks. The Actor's **SSE View** shows you the live data stream so you can verify if a hook was actually sent, regardless of when Zapier processes it. |
| **Silent Failures** | Check for `forward_error` items in the Dataset. If Zapier is down, the Actor logs the exact error code (e.g., `503`) and keeps the payload safe for later.              |

## 🔄 The "Smart Filter" Workflow

1. **Gatekeep**: Point Shopify/Stripe to the Actor URL.
2. **Validate**: Configure `jsonSchema` to only allow high-value events through.
3. **Bridge**: The Actor forwards valid requests to Zapier/Make.
4. **Resend**: If a Zap fails due to a configuration error, don't trigger a new sale. Just go to the Actor's dataset and use the **Replay API** to resend the exact payload to your fixed Zap.

```bash
# Replay to Zapier once the mapping is fixed
curl -X GET "https://webhook-debugger-logger.apify.actor/replay/wh_zap/evt_77?url=https://hooks.zapier.com/hooks/catch/fixed"
```
