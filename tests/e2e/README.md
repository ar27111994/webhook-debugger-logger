# End-to-End Test Suite

This directory contains black-box tests that execute the application as a spawned process and verify behavior over HTTP.

## Scope

- Startup, readiness, and shutdown behavior
- Security boundaries under production-like process execution
- Resilience, lifecycle, and production scenario validation

## Conventions

- Use [tests/setup/helpers/e2e-process-harness.js](../setup/helpers/e2e-process-harness.js)
- Prefer deterministic retries and bounded timeouts
- Always cleanup spawned processes and temporary storage

## Known Runtime Signals

- Process startup/shutdown logs are expected and part of normal harness behavior.
- Timeout and retry logs may be expected in resilience scenarios and should only be treated as failures if assertions fail.
