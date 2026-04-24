# Integration Test Suite

This directory contains in-process integration tests that validate module interaction boundaries using real route wiring and selected external mocks.

## Scope

- App lifecycle and middleware composition
- Route + middleware + repository contracts
- Security and sanitation behavior across multiple modules
- Concurrency and stress behavior for in-process integration boundaries

## Conventions

- Prefer shared helpers under [tests/setup/helpers](../setup/helpers)
- Use explicit assertions for every action
- Keep setup and teardown isolated per test
- Use `setupTestApp()` as the default app bootstrap helper because it resets the Jest module registry before loading `src/main.js`, preventing route and singleton leakage across repeated in-process app boots.
- Keep `node:fs/promises` real for suites that boot through `setupTestApp()` or `startIntegrationApp()`. The harness depends on `mkdtemp()` to create a unique `APIFY_LOCAL_STORAGE_DIR`, and it now fails fast if a mocked `mkdtemp()` does not return a usable path.
- Let `setupTestApp()` own teardown as well; it now removes process signal listeners and Actor listeners registered during initialization so lifecycle-heavy suites stay isolated.

## Known Runtime Signals

- Re-initialization warnings and `TEST_COMPLETE` shutdown logs are expected in lifecycle-oriented integration suites.
- Background timeout logs can be expected in resilience-focused integration cases where timeout behavior is part of the assertion.
