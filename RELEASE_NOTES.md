# v3.0.0 Release Notes - Webhook Debugger & Logger

This release marks a complete rewrite and hardening of the Webhook Debugger & Logger Actor, focusing on production readiness, security, and test coverage.

## 🔒 Security Hardening

- **SSRF Protection:** Enhanced validation for forwarded webhooks to prevent internal network scanning.
- **Data Masking:** Automatic redaction of sensitive headers (Authorization, Cookies, API Keys) in logs.
- **Rate Limiting:** Implemented robust rate limiting for both management API and webhook ingestion.
- **Input Validation:** Strict JSON schema validation for all inputs and configurations.
- **Secure Defaults:** Middleware now enforces strict security headers by default.

## 🏗 Architectural Improvements

- **Modular Middleware:** Split validation logic into dedicated middleware components (`auth.js`, `json_parser.js`, `security.js`, `error.js`).
- **Route Separation:** Refactored monolithic routing into clean, domain-specific modules (`dashboard.js`, `logs.js`, `replay.js`, `info.js`).
- **Hot Reloading:** New `HotReloadManager` allows configuration updates (auth keys, limits) without restarting the container.
- **Robust Error Handling:** Centralized error handling middleware ensures consistent JSON/HTML responses and prevents leaks.

## 🧪 Testing & Quality Assurance

- **100% Test Coverage:** Achieved full statement and branch coverage across the entire codebase.
- **Comprehensive Suite:** Added 350+ tests covering:
  - **Unit Tests:** Individual components, utilities, and middleware.
  - **Integration Tests:** End-to-end flows, webhook lifecycle, and hot-reloading.
  - **Edge Case Tests:** Large payloads, malformed JSON, network timeouts, and concurrency.
  - **Stress Tests:** Validated stability underneath high load.
- **Type Safety:** Implemented strict JSDoc typing throughout `src/` and `tests/` with `assertType` helpers for mock safety.
- **Signature Verification:** Added dedicated verification for Stripe, Shopify, GitHub, and Slack webhooks.

## 🚀 New Features

- **Replay Protection:** Smart replay logic with exponential backoff for failed forwarding attempts.
- **Dashboard Upgrades:** improved UI for reviewing logs and managing configurations.
- **Configurable Retention:** Automated cleanup of old logs based on configurable hours.

## 📦 Dependency Updates

- Upgraded all core dependencies to latest stable versions.
- Removed unused legacy packages.
