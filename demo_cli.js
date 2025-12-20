import axios from "axios";
import { EventSource } from "eventsource";
import qs from "qs";

const BASE_URL = "http://localhost:8080";

/**
 * WEBHOOK DEBUGGER - LIVE CLI DEMO
 * This script demonstrates the real-time capabilities of the Actor.
 */
async function runDemo() {
  console.log(
    "\n\x1b[36m%s\x1b[0m",
    "🚀 WEBHOOK DEBUGGER & LOGGER - LIVE DEMO"
  );
  console.log("------------------------------------------");

  try {
    // 1. Get Active Webhooks
    const info = await axios.get(`${BASE_URL}/info`);
    const { activeWebhooks } = info.data;
    const whId = activeWebhooks[0].id;

    console.log(
      `\x1b[32m[URLS]\x1b[0m Generated: ${activeWebhooks
        .map((w) => w.id)
        .join(", ")}`
    );
    console.log(`\x1b[32m[URLS]\x1b[0m Using for demo: ${whId}\n`);

    // 2. Start SSE Listener
    console.log("\x1b[33m[STREAM]\x1b[0m Connecting to Live Stream...");
    const es = new EventSource(`${BASE_URL}/log-stream`);

    es.onopen = () =>
      console.log("\x1b[33m[STREAM]\x1b[0m Connected! Waiting for events...\n");

    es.onmessage = (event) => {
      if (event.data === ": heartbeat") return;
      const data = JSON.parse(event.data);
      console.log("\n\x1b[35m[EVENT RECEIVED]\x1b[0m");
      console.log(`- Method: \x1b[1m${data.method}\x1b[0m`);
      console.log(`- Status: \x1b[32m${data.statusCode}\x1b[0m`);
      console.log(`- Path:   /webhook/${data.webhookId}`);
      console.log(`- Body:   ${data.body.substring(0, 50)}...`);
      console.log("------------------------------------------");
    };

    // 3. Trigger events sequentially
    setTimeout(async () => {
      console.log("\x1b[90m[ACTION]\x1b[0m Sending JSON payload...");
      await axios.post(`${BASE_URL}/webhook/${whId}`, {
        hello: "Apify World!",
      });
    }, 2000);

    setTimeout(async () => {
      console.log("\x1b[90m[ACTION]\x1b[0m Sending Form Data...");
      await axios.post(
        `${BASE_URL}/webhook/${whId}`,
        qs.stringify({ user: "tester", action: "login" }),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );
    }, 5000);

    setTimeout(async () => {
      console.log("\x1b[90m[ACTION]\x1b[0m Forcing 401 Unauthorized...");
      try {
        await axios.get(`${BASE_URL}/webhook/${whId}?__status=401`);
      } catch (e) {}
    }, 8000);

    setTimeout(() => {
      console.log(
        "\n\x1b[36m%s\x1b[0m",
        "✨ Demo complete. Press Ctrl+C to exit."
      );
    }, 12000);
  } catch (error) {
    console.error(
      "\x1b[31m[ERROR]\x1b[0m Setup failed. Is the Actor running on port 8080?"
    );
  }
}

runDemo();
