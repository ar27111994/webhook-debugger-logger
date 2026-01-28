---
trigger: always_on
description: Actor Master Agent Guide
---

# Actor Master Agent Guide

Use this guide to decide which per-language playbook to follow and how to integrate the Chrome DevTools MCP server into every stage of building and deploying an Apify Actor.

## Workflow Overview

1. **Understand the goal and constraints**
   - Clarify required data fields, freshness, run frequency, and SLA.
   - Note any target site restrictions (robots.txt, auth, rate limits).
   - Identify available SDKs/dependencies in the current project before assuming a stack.
2. **Interrogate the target site with Chrome DevTools MCP (always)**
   - Open the site with the Chrome DevTools MCP server before writing Actor code.
   - Capture an a11y snapshot for structure, check console for blockers, and inspect network requests for APIs or data endpoints.
   - Only broaden the investigation (e.g., full-network capture, performance trace) when specific questions arise to avoid unnecessary context usage.
3. **Select the leanest implementation path**
   - Prefer HTTP/Cheerio-style scraping or direct API calls when possible.
   - Escalate to headless browsers (Playwright/Puppeteer) only when JavaScript execution is proven necessary.
   - Use the smallest language/runtime surface that satisfies requirements and matches team expertise.
4. **Prototype locally**
   - Start from the relevant per-language guide below.
   - Validate input handling, storage writes, and error behavior with `apify run`.
   - Keep concurrency and resource usage conservative until stability is confirmed.
5. **Harden and document**
   - Add retries, validation, and structured output once the workflow is reliable.
   - Update `.actor/input_schema.json` and `.actor/output_schema.json` alongside code.
6. **Deploy intentionally**
   - When local runs are stable, authenticate with `apify login` and publish via `apify push`.
   - Capture run instructions, known limitations, and monitoring notes in the Actor README or dataset metadata.

## Choosing a Language Playbook

- **JavaScript (`js.AGENTS.md`)**
  - Use when the project already depends on Node.js tooling or when leveraging Apify’s JavaScript SDK features (e.g., `CheerioCrawler`, `PlaywrightCrawler`) is expected.
  - Ideal for fast iteration with minimal build tooling.
- **TypeScript (`ts.AGENTS.md`)**
  - Choose if static typing will reduce risk (complex transformations, large teams) and the repo already has a TypeScript build setup.
  - Balance the compile step against the maintainability gains.
- **Python (`python.AGENTS.md`)**
  - Reach for this when existing libraries or data processing stacks are Python-centric.
  - Confirm Docker image size and dependency footprint stay within platform limits; prefer lightweight packages.

If multiple options are viable, default to the stack with existing project scaffolding to minimize setup time.

## Using Chrome DevTools MCP Effectively

- **Before coding**
  - Launch the target URL, grab quick DOM snapshots, and search for `fetch`/XHR calls that carry the needed data.
  - Check for login flows, anti-bot scripts, or dynamically injected content.
- **During development**
  - Validate selectors and API responses against live pages as you implement handlers.
  - Monitor network throttling, request patterns, and potential rate-limit headers for tuning crawler settings.
- **For debugging and QA**
  - Reproduce failing runs, capture screenshots, and export network traces to understand regressions.
  - Use selective tracing to avoid bloating the MCP conversation.

Always shut down the browser session when done to release resources.

### Chrome DevTools MCP Toolset

- `mcp__chrome-devtools__take_snapshot` – capture the latest accessibility tree to confirm DOM structure and locator stability before implementing selectors.
- `mcp__chrome-devtools__list_network_requests` / `mcp__chrome-devtools__get_network_request` – review network calls and drill into promising API responses; only request bodies when a URL looks relevant.
- `mcp__chrome-devtools__evaluate_script` – run small JavaScript probes in-page to verify data availability or extract state without reloading.
- `mcp__chrome-devtools__take_screenshot` – grab targeted visual evidence for QA or to understand layout-driven parsing issues.
- `mcp__chrome-devtools__list_console_messages` – surface runtime errors, CSP blocks, or anti-bot warnings that impact scraping reliability.
- `mcp__chrome-devtools__performance_start_trace` / `mcp__chrome-devtools__performance_stop_trace` – record traces sparingly when diagnosing slow loads or determining whether heavy browser automation is justified.

## Optimization Principles

- Target lightweight HTTP-first solutions; only upgrade to headless browsing after confirming it is required.
- Cache or reuse request queues and dataset entries where Apify’s storage layer allows.
- Set concurrency defaults conservatively and scale up after measuring site tolerance.
- Keep payloads small—omit fields, compress assets, and avoid unnecessary data transformations.
- Document any unavoidable heavy operations so future runs can monitor their costs.

## When to Consult Individual Guides

- After selecting the language, open the corresponding `*.AGENTS.md` for:
  - Boilerplate code structures (`Actor.init`, routers, storage usage).
  - Language-specific patterns for input validation, retries, and resource management.
  - Deployment caveats (Dockerfile tweaks, dependency installation guidance).
- Return to this master guide whenever pivoting stacks or reassessing tooling choices.

## Deliverables Checklist

- ✅ Target site analyzed with Chrome DevTools MCP (DOM, console, network checks recorded).
- ✅ Implementation language chosen with rationale.
- ✅ Local run passes with required inputs and produces structured outputs.
- ✅ Input/output schemas updated to match behavior.
- ✅ Resource usage audited; browser automation justified if used.
- ✅ Actor deployed via `apify push` with documentation for operating it.

Follow this sequence to keep builds fast, maintainable, and cost-effective.
