## [3.2.0] - 2026-02-10

### Refactored (3.2.0)

- **Forwarding Architecture**: Extracted shared logic into `ForwardingService`.
  - Created `src/services/CircuitBreaker.js` to isolate circuit breaker logic.
  - Implemented `sendSafeRequest` in `ForwardingService` to reuse retry/SSRF/Circuit-Breaker logic.
  - Refactored `replay.js` to use `ForwardingService`, ensuring consistent security (SSRF, Header Filtering) and reliability (Retries, Circuit Breaker) for replay requests.
  - Implemented Singleton pattern for `ForwardingService` via `src/services/index.js` to share circuit breaker state between ingestion middleware and replay route.

### Fixed (3.2.0)

- **Linting**: Resolved unused variable warnings and TypeScript type mismatches in `replay.js` and `logger_middleware.js`.
- **Logic**: Removed redundant try/catch wrappers in `ForwardingService.js`.
