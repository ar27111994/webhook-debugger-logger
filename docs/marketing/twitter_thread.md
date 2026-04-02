# 🧵 Twitter Thread: Webhook Debugger & Logger Launch

1/8
🚀 Debugging webhooks on localhost? Stop using ngrok.
Introducing **Webhook Debugger & Logger v3.0** (Enterprise Suite) on @Apify.

Fast acknowledgment path. Live log streaming endpoint (`GET /log-stream`). OOP Architecture.
And it's completely open-source. 👇
[Link to Actor]

2/8
🔥 **The Problem:**
Testing Stripe/Shopify/GitHub webhooks locally is a pain.
You need tunnels, you lose logs if the tunnel crashes, and you can't verify signatures easily.

3/8
✅ **The Solution:**
We built a high-performance Express.js actor that:

- Generates instant webhook URLs
- Validates signatures (HMAC-SHA256)
- Streams logs to your terminal via `GET /log-stream`
- Replays failed events

4/8
🛡️ **Enterprise Security:**

- IP Whitelisting (CIDR)
- API Key Authentication
- Automatic PII redaction
- SSRF Protection

All built-in. No configuration hell.

5/8
🔄 **Hot Reloading:**
Need to change your rate limit or retention policy?
Just edit your `INPUT.json`. The actor updates instantly without restarting.
Zero downtime.

6/8
🧠 **Architecture Geekery:**
We just refactored the core to a solid OOP design:

- `LoggerMiddleware`: Modular request processing
- `AppState`: Centralized runtime state
- `HotReloadManager`: Environment-agnostic config updates

Check out the code: [GitHub Link]

7/8
💡 **Use Case:**
Building an AI agent?
Connect this Actor via MCP (Model Context Protocol).
"Claude, watch for the next Stripe payment and verify the amount."
It works out of the box.

8/8
Try it now for free on the Apify Store.
Let me know what you think!
#webdev #apify #webhooks #nodejs #opensource
