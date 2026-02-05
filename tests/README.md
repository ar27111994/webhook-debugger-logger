# Test Suite Guide

## Overview

This directory contains all test files for the Webhook Debugger & Logger.

## Test Suite Organization

The test suite is organized into the following categories:

- **`tests/unit/`**: Tests for individual modules and classes in isolation (e.g., `rate_limiter`, `config`).
- **`tests/integration/`**: Tests verifying interactions between modules (e.g., `routes`, `middleware`, `lifecycle`).
- **`tests/e2e/`**: Full end-to-end system tests covering real-world scenarios (e.g., `resilience`, `concurrency`).
- **`tests/setup/`**: Shared helpers, mocks, and global setup logic.

## Test Helpers

### Mock Setup (`setup/helpers/mock-setup.js`)

Centralized mock registration. Import BEFORE any source code:

```javascript
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({
  axios: true,
  apify: true,
  dns: true,
  db: true,
  consts: true,
});
```

### Shared Mocks (`setup/helpers/shared-mocks.js`)

- `apifyMock` - Mock Apify Actor
- `axiosMock` - Mock axios
- `dnsPromisesMock` - Mock DNS resolution
- `ssrfMock` - Mock SSRF validation
- `duckDbMock` - Mock DuckDB instance/connection
- `constsMock` - Mocked application constants
- `webhookManagerMock` - Mock for WebhookManager
- `createMockWebhookManager()` - WebhookManager mock factory
- `createDatasetMock()` - Dataset mock factory
- `fsPromisesMock` - Mock for `node:fs/promises`
- `logRepositoryMock` - Mock for LogRepository
- `loggerMock` - Mock for logger

### Test Utilities (`setup/helpers/test-utils.js`)

- `createMockRequest()` - Express Request mock
- `createMockResponse()` - Express Response mock
- `createMockNextFunction()` - Express NextFunction mock
- `assertType<T>()` - Type-safe casting helper
- `getLastAxiosCall(axios, method)` - Get arguments of last axios call
- `getLastAxiosConfig(axios, method)` - Get config object of last axios call
- `waitForCondition(condition, timeout, interval)` - Poll for a condition (better than sleep)

### Lifecycle Helpers (`setup/helpers/test-lifecycle.js`)

- `useMockCleanup()` - Auto-clear mocks in beforeEach
- `useFakeTimers()` - Auto-manage fake timers
- `useConsoleSpy()` - Auto-manage console spies

### Specialized Helpers

- `setupTestApp()` (`app-utils.js`) - Initialize app and supertest client
- `resetDb()` (`db-hooks.js`) - Clear DuckDB logs table
- `createStripeSignature()`, etc. (`signature-utils.js`) - Webhook signature generators
- `createMiddlewareTestContext()` (`middleware-test-utils.js`) - Middleware test setup

## Best Practices

1. **Always use helpers** instead of repeating setup code
2. **Import setupCommonMocks first** in test files
3. **Use lifecycle helpers** for beforeEach/afterEach patterns
4. **Avoid `@type {any}`** - use `assertType<T>()` or proper types
5. **Keep tests isolated** - use `useMockCleanup()`
6. **Place new tests** in the appropriate subdirectory (`unit`, `integration`, or `e2e`)

## Running Tests

```bash
# All tests
npm test

# All Unit Tests
npm test tests/unit/

# All Integration Tests
npm test tests/integration/

# All E2E Tests
npm test tests/e2e/

# Specific file
npm test -- tests/unit/rate_limiter.test.js

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
# OR
npm run test:coverage
```
