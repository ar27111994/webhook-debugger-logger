# 🚀 Webhook Debugger & Logger

![Dashboard Mockup](./assets/dashboard.png)

A high-performance Apify Actor built for developers to test, inspect, and automate incoming webhooks in real-time.

## ⚡ Live Demo (Local)

Run the following command while the Actor is active to see real-time streaming:

```bash
node demo_cli.js
```

Test and inspect webhooks instantly without running localhost or complex tunneling tools.

**[Watch the 2-min Narrated Walkthrough](https://youtu.be/uefialldYYw)**

## What does it do?

Webhook Debugger generates temporary webhook URLs and logs every incoming request with full details (headers, body, query params). Perfect for testing webhook integrations from Stripe, GitHub, Shopify, or any service.

**What it does NOT do**:

- ❌ Modify webhooks (read-only logging)
- ❌ Replay webhooks (data capture only)
- ❌ Permanent storage (auto-cleanup after 1-72 hours)

## Why use Webhook Debugger?

### The Problem

Debugging webhooks is painful:

- ❌ Can't see what data services send
- ❌ No way to inspect payloads
- ❌ Localhost tunneling is complicated (ngrok, etc.)
- ❌ Failed webhook tests require service reconfiguration

### The Solution

1. **Run Webhook Debugger**
2. **Get 3 unique webhook URLs**
3. **Configure service to send to those URLs**
4. **See all requests in real-time**
5. **Export logs as JSON/CSV**

No setup required. No localhost tunneling. Takes 30 seconds.

## What can this Actor do?

| Feature             | Description                                             |
| ------------------- | ------------------------------------------------------- |
| **URL Generation**  | Generate 1-10 temporary webhook URLs                    |
| **Request Logging** | Capture ALL incoming requests (GET, POST, etc.)         |
| **Full Details**    | Headers, body, query params, IP, timing                 |
| **Multi-Format**    | Handles JSON, Text, XML, and Form Data                  |
| **Auto-Cleanup**    | URLs and data expire automatically (configurable 1-72h) |
| **Export**          | Download logs as JSON or CSV from dataset               |

## Input example

### Simple mode (basic)

```json
{
  "urlCount": 3,
  "retentionHours": 24
}
```

### Advanced mode

```json
{
  "urlCount": 5,
  "retentionHours": 72,
  "maxPayloadSize": 10485760,
  "enableJSONParsing": true
}
```

## Output example

### JSON format (Dataset)

```json
{
  "timestamp": "2025-12-19T14:31:45Z",
  "webhookId": "wh_abc123",
  "method": "POST",
  "headers": {
    "content-type": "application/json",
    "user-agent": "Stripe/1.0"
  },
  "body": "{\"type\": \"payment.success\", \"amount\": 9999}",
  "size": 78,
  "contentType": "application/json",
  "processingTime": 12,
  "remoteIp": "1.2.3.4"
}
```

### CSV Output Format (Preview)

| Timestamp        | Webhook ID | Method | Status | Content-Type                      | Size (B) | Latency (ms) |
| :--------------- | :--------- | :----- | :----- | :-------------------------------- | :------- | :----------- |
| 2025-12-19 14:31 | wh_abc123  | POST   | 200    | application/json                  | 1,240    | 12           |
| 2025-12-19 14:35 | wh_xyz789  | GET    | 401    | -                                 | 0        | 5            |
| 2025-12-19 14:40 | wh_abc123  | POST   | 200    | application/x-www-form-urlencoded | 450      | 8            |

## How to get started

**Step 1**: Start the Actor and wait for it to enter "Running" state.

**Step 2**: Click on the **Live View** or check the **Key-Value Store** for the `WEBHOOK_STATE` key to see your assigned IDs.

**Step 3**: Use the URL format: `https://<actor-run-id>.runs.apify.net/webhook/<id>`

**Step 4**: Configure your service (Stripe, GitHub, etc.) to send to this URL.

**Step 5**: When webhooks arrive, they'll appear in the **Dataset** tab in real-time.

## Usage Examples

### 1. Simple GET request

```bash
curl -v https://<ACTOR-RUN-URL>/webhook/wh_abc123?test=true
```

### 2. Post JSON data

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"event": "user_signup", "userId": "123"}' \
  https://<ACTOR-RUN-URL>/webhook/wh_abc123
```

### 3. Send raw text/XML

```bash
curl -X POST -H "Content-Type: text/xml" \
  -d '<event><type>ping</type></event>' \
  https://<ACTOR-RUN-URL>/webhook/wh_abc123
```

### 4. Upload a small file

```bash
curl --upload-file document.txt https://<ACTOR-RUN-URL>/webhook/wh_abc123
```

### 5. Check active webhooks

```bash
curl https://<ACTOR-RUN-URL>/info
```

## Advanced Features

### Real-time Log Stream (SSE)

You can stream webhook logs in real-time as they arrive using Server-Sent Events (SSE). This is perfect for terminal monitoring or custom dashboards.

**Endpoint**: `https://<ACTOR-RUN-URL>/log-stream`

**How to monitor via CLI**:

```bash
curl -N https://<ACTOR-RUN-URL>/log-stream
```

### Forced Status Codes

You can force a specific HTTP status response by adding the `__status` query parameter to your webhook URL.

- `https://<URL>/webhook/wh_123?__status=401` -> Returns 401 Unauthorized
- `https://<URL>/webhook/wh_123?__status=500` -> Returns 500 Internal Server Error

### Filtering & Querying Logs (API)

You can retrieve and filter logs programmatically via the `/logs` endpoint.

**Endpoint**: `https://<ACTOR-RUN-URL>/logs`

**Query Parameters**:

- `webhookId`: Filter by a specific ID (e.g., `wh_abc123`)
- `method`: Filter by HTTP method (e.g., `POST`)
- `statusCode`: Filter by response code (e.g., `201`)
- `contentType`: Search for specific content types (e.g., `json`)
- `limit`: Number of items to return (default: 100)

**Example**:

```bash
curl "https://<ACTOR-RUN-URL>/logs?method=POST&statusCode=200"
```

### Filtering Logs (Platform)

Apify Datasets support basic filtering via API parameters.

- **Newest first**: Add `?desc=1`
- **JSON Clean**: Add `?clean=1` (omits Apify metadata)
- **Specific fields**: Add `?fields=timestamp,method,body`

## Integrations (Zapier / Make)

Webhook Debugger is the perfect "safe buffer" for your automations.

### Why integrate?

- **Logs everything**: Even if your Zap fails, you have the raw request in Apify.
- **Payload transformation**: Apify datasets make it easy to clean/inspect data before it hits your automation.

### Setup Guide (Zapier/Make)

1. **Source**: Point your service (Stripe, Shopify, etc.) to the Actor's webhook URL.
2. **Apify Webhook**:
   - Go to your Actor's **Integrations** tab.
   - Set up a webhook to trigger on **Dataset item created**.
   - Point this Apify webhook to your **Zapier/Make "Catch Webhook"** URL.
3. **Data Flow**: `Stripe` -> `Webhook Debugger` -> `Apify Dataset` -> `Zapier`.
4. **Benefit**: You get real-time logging AND immediate automation trigger.

## Pricing

This Actor uses **Pay-per-Event (PPE)** pricing, meaning you only pay for the requests you actually log:

- **$0.01 per webhook request logged**
- Batch: 100 webhooks = $1
- Batch: 1,000 webhooks = $10

Compare to ngrok's monthly subscriptions just to get persistent local URLs.

## FAQ

**Q: How long are webhook URLs valid?**
A: By default, 24 hours. You can set 1-72 hours in the input.

**Q: Will you store my data?**
A: No. Data is stored only in your Apify dataset (you own this). After the retention period expires, URLs and old requests are cleaned up.

**Q: What's the payload size limit?**
A: 10MB by default to ensure stability. Configurable in input up to 100MB.

**Q: Can I use this with Zapier or Make?**
A: Yes! It's an ideal "safe buffer." You can point your service to this Actor, then use an Apify Webhook to trigger your Zapier/Make flow whenever a new item is added to the dataset.

**Q: Are the webhooks truly private?**
A: Yes. All data is written directly to your own Apify account's default dataset. Only you (and whoever you share your Apify account with) can see the logs.

**Q: Can I override the response headers?**
A: Currently, we support status code overrides via `__status`. Full header customization is planned for a future update.

## Troubleshooting

**Issue**: "Webhook not found or expired"  
**Solution**: Verify the webhook ID is correct. Check the `/info` endpoint of your running Actor to see active IDs. If it expired, restart the Actor to generate new ones.

**Issue**: "Payload too large"  
**Solution**: The default limit is 10MB. If you expect larger payloads, increase `maxPayloadSize` in the input settings.

---

**Questions?**

- 💬 Join the [Apify Discord Community](https://discord.gg/jyEM2PRvMU)
- 📚 Read the [Apify SDK Documentation](https://sdk.apify.com/)
- 🛠️ Compare with [Webhook.site](https://webhook.site) (Desktop alternative)
- 📝 Open an issue on our [GitHub Repository](https://github.com/ar27111994/webhook-debugger-logger)

**Developer Support Guarantee**: I respond to all comments and bug reports on the Apify console within **24 hours**.
