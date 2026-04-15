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

## Known Runtime Signals

- Re-initialization warnings and `TEST_COMPLETE` shutdown logs are expected in lifecycle-oriented integration suites.
- Background timeout logs can be expected in resilience-focused integration cases where timeout behavior is part of the assertion.
