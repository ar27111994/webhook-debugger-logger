# Apify Actor Publication Guide

Please use the following branch-specific content to fill out your Actor's
publication forms.

## 1. Display Information

| Field | Recommended Value |
| :-- | :-- |
| **Icon** | [icon.png](./assets/icon.png) |
| **Actor Name** | `Webhook Debugger, Logger & API Mocking Suite` |
| **Description** | `Enterprise-grade webhook testing suite for developers. Capture, inspect, replay, forward, validate, and mock webhook traffic in real time without tunnels. Includes SSE live streaming, JSON Schema validation, and signature verification for Stripe, GitHub, Shopify, Slack, and custom HMAC workflows.` |
| **Categories** | `Developer Tools`, `Utilities`, `Integration Tools` |
| **SEO Title** | `Webhook Debugger & Logger - Webhook Testing, Replay & API Mocking` |
| **SEO Description** | `Capture and replay webhooks in real time, mock responses with latency, verify signatures, and inspect logs through a documented API. Ideal for Stripe, GitHub, Shopify, Slack, and custom integrations.` |

---

## 2. Monetization (Pay-per-Event)

To qualify for the $1M challenge and monetize your work, use these settings:

| Event Type      | Title              | Description                                             | Price      |
| :-------------- | :----------------- | :------------------------------------------------------ | :--------- |
| **Actor Start** | `Actor Start`      | `Charged when the Actor starts running (Standby mode).` | `$0.00005` |
| **Result**      | `Captured Webhook` | `Single webhook event logged to the dataset.`           | `$0.01`    |

> [!IMPORTANT]
> Setting the "Result" price to **$0.01** is the standard for the challenge and ensures you earn per logged event.

---

## 3. GitHub Integration (Highly Recommended)

If you have a GitHub account, link this repository. It improves your **Actor Quality Score** significantly!

- **Repository URL**: (Your GitHub URL)
- **Source Files**: Keep "Hide source files from Actor detail" **Checked** if you want to keep the code private, or uncheck it if you want the Actor to be open source.
- **Why it matters on this branch**: The repository now includes stronger API
  docs, architecture notes, and operational playbooks, so linking the repo adds
  real credibility to the listing.

---

## 4. Permissions (Critical for Quality Score)

This Actor is designed to work with **Limited Permissions**. Do **NOT** use Full Permissions, as it will lower your Actor Quality Score.

- **Permission Level**: `Limited Permissions`
- **Why**: The Actor runs as a standby-mode web server but still only needs to
  write to its own default dataset and key-value store. It does not require
  access to other user data.

## 5. Publication Notes for This Branch

- **Standby mode is enabled** in `.actor/actor.json`.
- **A web server schema is present** in `.actor/web_server_schema.json`.
- The listing copy should emphasize these concrete capabilities:
  - Real-time webhook capture and SSE streaming
  - Replay and forwarding workflows
  - Response mocking and latency simulation
  - Signature verification and security controls
  - A documented management API surface
- If you want to mention self-hosting, keep it out of the short Actor
  description and instead link users to the repository docs and standalone
  Docker guidance.

---

## 6. Next Steps

1. Copy-paste the values above into the forms shown in your screenshots.
2. Click **Save** in each section.
3. Click the final **Publish on Store** button at the bottom of the page.
