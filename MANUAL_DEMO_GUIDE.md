# 🎬 Manual Demo Recording Guide

Follow this 5-step choreography to create a professional 2-minute walkthrough.

### 🖥️ Recommended Layout

Split your screen: **Left side** (Apify Console) | **Right side** (Terminal or Postman).

---

### Step 1: Initialize & Start (0:00 - 0:43)

1. Open your Actor on the [Apify Console]([YOUR-ACTOR-URL]).
2. Click **Start** in the bottom left.
3. Narrate: _"We're starting the Webhook Debugger in Standby mode for instant response times."_
4. Go to the **Live View** or **URL** provided in the logs.

---

### Step 2: Show generated URLs (0:44 - 0:53)

1. Open the `/info` endpoint in a new browser tab:
   `https://[YOUR-ACTOR-RUN-URL]/info`
2. Narrate: _"The Actor automatically generates unique, temporary webhook endpoints for us."_

---

### Step 3: Real-time Monitor (0:54 - 1:47)

1. Open the `/log-stream` endpoint in a new browser tab. It will look like a white page waiting for data.
2. In your **Terminal** or **Postman**, send a POST request:

   ```bash
   curl -X POST https://[YOUR-ACTOR-RUN-URL]/webhook/[YOUR-WEBHOOK-ID] \
   -H "Content-Type: application/json" \
   -d '{"event": "demo_test", "status": "active"}'
   ```

3. Narrate: _"Watch the browser tab on the left — as soon as I send this request, the event appears instantly via Server-Sent Events."_

---

### Step 4: Status Code Overrides (1:48 - 1:55)

1. Send another request with a forced error code:

   ```bash
   curl -I "https://[YOUR-ACTOR-RUN-URL]/webhook/[YOUR-WEBHOOK-ID]?__status=401"
   ```

2. Narrate: _"Developers can even test error handling by overriding the response code using query parameters."_

---

### Step 5: The Dataset View (1:56 - 2:17)

1. Go back to the Apify Console and click the **Dataset** tab.
2. Switch to the **Table view**.
3. Narrate: _"All events are permanently logged in the Apify Dataset with full metadata, available for export as JSON or CSV."_
4. Click **Stop** on the Actor.

---

### 💡 Pro Tips for a Great Video

- **Zoom In**: Press `Cmd +` or `Ctrl +` so the text is easy to read on mobile.
- **Hide Personal Data**: Ensure no private tokens are visible.
- **Narrate clearly**: Explain _why_ a feature is useful while you show it.
