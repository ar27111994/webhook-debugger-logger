# 💳 Stripe Webhook Hardening Playbook

Use this playbook to verify signatures, inspect event payloads, and re-run payment fulfillment logic without exhausting your Stripe test event limits.

## 🚀 One-Click Configuration

**[Launch Webhook Debugger with Stripe Presets](https://apify.com/ar27111994/webhook-debugger-logger?input=%7B%22defaultResponseCode%22%3A200%2C%22maskSensitiveData%22%3Atrue%2C%22jsonSchema%22%3A%22%7B%5C%22type%5C%22%3A%5C%22object%5C%22%2C%5C%22required%5C%22%3A%5B%5C%22type%5C%22%2C%5C%22data%5C%22%5D%7D%22%7D)**

## 📋 Recommended Input (JSON)

```json
{
  "authKey": "stripe-verification-key",
  "allowedIps": ["3.18.12.63"], // Example IP; Always verify against official docs
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"received\": true}",
  "maskSensitiveData": true,
  "jsonSchema": "{\"type\":\"object\",\"required\":[\"type\",\"data\"]}"
}
```

> [!IMPORTANT] > **Verify Stripe IPs**: The `allowedIps` above are examples. Stripe frequently updates their webhook IP ranges. Always consult the [Official Stripe Webhook IP Documentation](https://stripe.com/docs/webhooks#ip-addresses) to ensure your whitelist is up to date.

## 🔍 Common Stripe Error Patterns

| Error Signal                    | Description                                            | Solution                                                 |
| :------------------------------ | :----------------------------------------------------- | :------------------------------------------------------- |
| `400 Bad Request`               | Invalid JSON or missing required fields.               | Double-check your `jsonSchema` in the Actor input.       |
| `Signature Verification Failed` | Headers were modified or `forwardHeaders` is false.    | Enable `forwardHeaders` in the pipe configuration.       |
| `Timed Out`                     | Your local server took >10s to respond to the forward. | Use the **Replay** feature after fixing your local code. |

## 🛠️ Typical Workflow

1. **Set up**: Point your Stripe Dashboard (Webhooks) to the generated Actor URL.
2. **Inspect**: Buy a "Test Product" and see the `checkout.session.completed` event in real-time.
3. **Fix**: If your code crashes, fix the bug.
4. **Replay**: Use `/replay/:id` to resend the exact same Stripe payload to your server without triggering a new purchase.
