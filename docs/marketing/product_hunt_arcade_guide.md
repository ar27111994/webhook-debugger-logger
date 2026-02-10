# 🕹️ Arcade Interactive Demo Guide: Webhook Debugger & Logger

This guide helps you create a high-converting, "click-through" interactive demo for your Product Hunt launch. Using [Arcade](https://www.arcade.software/) instead of a video allows hunters to "touch" the product, leading to 2x higher engagement.

---

## 🎭 The Narrative Arc: "From Pain to Profit"

Don't just show features; tell a story.

- **The Villain**: A broken Stripe integration and a developer (you) who can't see why.
- **The Hero**: The Webhook Debugger.
- **The Victory**: A fixed integration in under 60 seconds.

---

## 📽️ The "Masterclass" Recording Script

### Scene 1: The "Aha!" Moment (Setup)

- **Action**: Start on the Apify Actor page. Hover over the **"Standby Mode"** badge.
- **Click**: The "Start" button.
- **Insight**: Highlight that the Actor is ready in **<1 second** due to Standby Mode.
- **Callout**: "Stop waiting for cold starts. Get your test endpoints instantly."

### Scene 2: The Mock & Block (Advanced Mocking)

- **Action**: Go to the **Input** tab.
- **Edit**: Change `defaultResponseCode` to `402` (Payment Required).
- **Edit**: Change `defaultResponseBody` to `{"error": "Subscription Expired"}`.
- **Action**: Send a request from your terminal/ReqBin.
- **Show**: The terminal receiving the 402 error.
- **Callout**: "Mock failures to test your error handling without breaking production."

### Scene 3: The Fortress (Enterprise Security)

- **Action**: Toggle on **"Auth Key"** in the input.
- **Action**: Send a request _without_ the key to show a `401 Unauthorized`.
- **Action**: Add the key `?key=secret` and show success.
- **Callout**: "Secure your logs. Enterprise-grade IP whitelisting & Auth included."

### Scene 4: The Time Machine (Request Replay)

- **Action**: Hover over an old request in the dataset.
- **Click**: The `/replay` URL.
- **Action**: Show the payload being successfully re-sent to a new URL.
- **Callout**: "Fix your code, then replay the exact same traffic with one click."

---

## 🎨 Professional Post-Production

### 📱 Mobile-First Optimization

50% of Product Hunt traffic comes from the mobile app.

- **Zoom Levels**: Use a **150% zoom** in your browser while recording so text is readable on small screens.
- **Pan Effect**: Use Arcade's "Pan" tool to move from the Input settings to the Output dataset.
- **Duration**: Keep the total demo under **45 seconds**. Hunters have short attention spans.

### ✨ Visual Polish

- **Blurring**: Use the Arcade blur tool to hide your Apify User ID or any sensitive API keys.
- **Theme**: Set your primary color to `#FF6437` (Product Hunt Orange) or `#00A388` (Apify Teal).
- **Sound**: Choose a "Lo-fi" or "Corporate Tech" background track at **10% volume** to add a premium feel without being distracting.

---

## 🚀 Product Hunt Launch Day Tactics

### 💬 The "First Comment" Strategy

As soon as you launch, post the link to your Arcade demo in your **Maker's Comment**.

> "I know you're busy, so I made this 30-second interactive demo where you can 'click through' the core features yourself! [Link]"

### 📊 Engagement Loops

- **The "Challenge"**: Ask hunters to try sending a webhook to a demo URL and post the result in the comments.
- **Update Frequency**: If you hit #1 or #3 on the leaderboard, update your Arcade CTA to say: _"Thanks for the support! 🚀 Try it for free below."_

---

## 💡 v2.5.0 Standby Mode Spotlight

Your demo should feel **instant**. If there is even a 2-second lag while you refresh the dataset, **crop those frames out** in Arcade. The goal is to show the power of Standby Mode’s sub-10ms response time.

_Tooltip suggestion_: "Direct-to-dataset streams. No delays, no polling."
