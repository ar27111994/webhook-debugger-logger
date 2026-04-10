# Release Notes

These notes summarize the current branch relative to `main` as of 2026-04-02.
They are based on the actual `git diff main...HEAD` plus representative
runtime, schema, deployment, test, and documentation changes, not only commit
messages.

## Executive Summary

This branch is a substantial production-hardening rewrite of the actor. It
turns the project into a more explicit web-server product for both Apify-hosted
and self-hosted usage, with a documented HTTP contract, stronger security
controls, richer log and replay workflows, a broader deployment story, and a
much deeper quality and documentation posture.

Compared with `main`, the branch introduces:

- An Apify standby-mode web server contract via `.actor/web_server_schema.json`
  and `.actor/actor.json`.
- A clearer modular runtime split across routes, middleware, services,
  repositories, constants, and utilities.
- A stronger DuckDB-backed read model with richer filtering, pagination, and
  payload retrieval flows.
- Expanded webhook security, including provider-specific signature validation,
  request protection, and safer forwarding behavior.
- A self-hosted standalone container track and GitHub-based Docker release
  automation.
- Significantly broader tests, operational playbooks, and API documentation.

## Change Scope

- 269 files changed
- 48,550 insertions
- 8,611 deletions

## Product Highlights

### Hosted web server and API contract

- Added Apify `webServerSchema` support with a machine-readable OpenAPI
  contract in `.actor/web_server_schema.json`.
- Enabled `usesStandbyMode: true` in `.actor/actor.json`, positioning the Actor
  as a long-lived web server rather than only a fire-and-exit task.
- Formalized the HTTP surface for dashboard, webhook ingress, logs, replay,
  streaming, system metrics, health, and readiness routes.
- Added a source-aligned API reference in `docs/api-reference.md`.

### Webhook capture, inspection, and replay

- Reworked log storage and querying around a dedicated DuckDB repository layer.
- Added richer `/logs` query support, including range-style filters,
  signature-related filters, sort controls, and cursor-based pagination for
  larger datasets.
- Added dedicated log detail and payload retrieval paths for investigation and
  forensics workflows.
- Expanded replay controls with configurable retry counts and request timeouts.

### Security and verification

- Added provider-aware signature verification for Stripe, Shopify, GitHub,
  Slack, and custom HMAC integrations.
- Hardened request handling with auth gating, IP allowlisting, payload and
  header redaction, structured error handling, and forwarding loop detection.
- Split traffic protection into management-endpoint rate limiting and
  per-webhook ingestion rate limiting.
- Preserved SSRF protection and safe forwarding behavior while broadening the
  automation surface.

### Self-hosting and release engineering

- Added `Dockerfile.standalone` for self-hosted deployment outside the Apify
  runtime image path.
- Added `.github/workflows/release-docker.yml` to publish standalone
  multi-architecture images.
- Added support scripts for coverage enforcement, version synchronization, and
  web server schema validation.
- Expanded CI and repository automation with additional workflows, formatting,
  linting, and dependency-management configuration.

### Documentation and developer experience

- Added or expanded architecture docs, API docs, local Docker guidance,
  operational playbooks, marketing collateral, roadmap notes, and contribution
  guidance.
- Added `.env.example` and local `.env` auto-loading support for CLI and
  self-hosted workflows.
- Added repository guidance files for agents, docs, testing, and publication
  readiness.

## Runtime and Architecture Changes

- Replaced the flatter structure with a more explicit modular monolith:
  `src/routes`, `src/middleware`, `src/services`, `src/repositories`,
  `src/consts`, and `src/utils` now capture clearer ownership boundaries.
- Migrated DuckDB integration to `@duckdb/node-api`, using cached instance
  management, connection pooling, and serialized writes via `Bottleneck`.
- Added a `HotReloadManager` that supports both Apify key-value-store polling
  and local filesystem watch behavior.
- Added `src/utils/load_env.js` so local `.env` files are loaded once for CLI
  and self-hosted runs without overriding injected environment variables.
- Expanded application metadata and runtime configuration through the actor
  input schema, including memory controls, replay behavior, alerting,
  forwarding, verification, and response simulation settings.

## API and Operator Impact

- The runtime now exposes a documented management API in addition to the
  dashboard UI.
- `/logs` is no longer just a simple listing surface; it behaves like a query
  interface over the DuckDB read model.
- Health, readiness, and system metrics endpoints make the service easier to
  run behind orchestrators and health checks.
- Standby mode and the web server schema improve discoverability and make the
  hosted Actor easier to consume as a service.
- The standalone container path broadens deployment options for teams that want
  the same product outside Apify.

## Testing and Quality Changes

- Replaced the older flatter test layout with explicit unit, integration, and
  end-to-end suites.
- Added extensive helper harnesses under `tests/setup/helpers` for isolation,
  mocking, database lifecycle control, payload fixtures, and process-based
  end-to-end testing.
- Added focused tests for routes, repositories, middleware, services,
  utilities, actor metadata behavior, and operational scripts.
- Added coverage matrix tooling and validation scripts to make release
  confidence more repeatable.

## Notable Documentation Additions

- `docs/api-reference.md`
- `docs/architecture.md`
- `docs/local_docker_testing.md`
- Multiple operational playbooks under `docs/playbooks/`
- Multiple roadmap design notes under `docs/roadmap/`
- Expanded release, publication, and contribution guidance

## Release Notes for Operators

- Hosted deployments should validate the web server schema before release.
- Self-hosted deployments can now use the standalone Node 24 container image
  path.
- Local development and self-hosted usage can rely on project-level `.env`
  loading without changing production-injected settings.
- Runtime auth, replay, forwarding, signature verification, and alerting are
  all more configurable than they were on `main`.

## Known Release-Management Follow-Up

- Current runtime metadata resolves to `3.0.0` in `package.json` and
  `.actor/actor.json`.
- `CHANGELOG.md` and the release copy in this branch are aligned to the
  `3.0.0` milestone release.
- Before cutting the next formal release, align package metadata, actor
  metadata, changelog entries, dashboard/runtime version display, and any store
  publication copy.

## Bottom Line

Relative to `main`, this branch is not a narrow patch release. It is a broad
upgrade in runtime structure, product surface, security posture, deployment
options, test depth, and documentation quality. It should be treated as a
significant milestone release and validated as both an Apify-hosted service and
an optionally self-hosted webhook platform.
