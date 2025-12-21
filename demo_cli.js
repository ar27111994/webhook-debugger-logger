import axios from "axios";
import EventSource from "eventsource";

/**
 * 🚀 WEBHOOK DEBUGGER & LOGGER - LIVE DEMO
 * ------------------------------------------
 *
 * This script demonstrates the real-time SSE streaming capabilities
 * of your newly created Actor.
 */

const BASE_URL = process.env.APIFY_ACTOR_URL || "http://localhost:8080";

async function runDemo() {
  console.log("\n🚀 WEBHOOK DEBUGGER & LOGGER - LIVE DEMO");
  console.log("------------------------------------------");

  try {
    // 1. Get active webhooks
    const infoRes = await axios.get(`${BASE_URL}/info`);
    const active = infoRes.data.activeWebhooks;

    if (active.length === 0) {
      console.log("[ERROR] No active webhooks found. Is the Actor running?");
      return;
    }

    const targetId = active[0].id;
    console.log(`[URLS] Generated: ${active.map((a) => a.id).join(", ")}`);
    console.log(`[URLS] Using for demo: ${targetId}\n`);

    // 2. Connect to SSE Stream
    console.log("[STREAM] Connecting to Live Stream...");
    const es = new EventSource(`${BASE_URL}/log-stream`);

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("\n[EVENT RECEIVED]");
      console.log(`- Method: ${data.method}`);
      console.log(`- Status: ${data.statusCode}`);
      console.log(`- Path:   /webhook/${data.webhookId}`);
      console.log(
        `- Body:   ${JSON.stringify(data.body, null, 2).substring(0, 100)}...`
      );
      console.log("------------------------------------------");
    };

    es.onerror = (err) => {
      console.error("[STREAM] Connection error:", err.message);
    };

    // 3. Send test requests
    setTimeout(async () => {
      console.log("[ACTION] Sending JSON payload...");
      await axios.post(`${BASE_URL}/webhook/${targetId}`, {
        hello: "Apify World!",
      });
    }, 1500);

    setTimeout(async () => {
      console.log("[ACTION] Sending Form Data...");
      const params = new URLSearchParams();
      params.append("user", "tester");
      params.append("action", "login");
      await axios.post(`${BASE_URL}/webhook/${targetId}`, params);
    }, 3000);

    setTimeout(async () => {
      console.log("[ACTION] Forcing 401 Unauthorized...");
      await axios
        .get(`${BASE_URL}/webhook/${targetId}?__status=401`)
        .catch(() => {});

      console.log("\n✨ Demo complete. Press Ctrl+C to exit.");
    }, 4500);
  } catch (err) {
    console.error("[ERROR] Setup failed. Is the Actor running on port 8080?");
  }
}

runDemo();
