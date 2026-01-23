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
await setupCommonMocks({ axios: true, apify: true, dns: true });
```

### Shared Mocks (`setup/helpers/shared-mocks.js`)

- `apifyMock` - Mock Apify Actor
- `axiosMock` - Mock axios
- `dnsPromisesMock` - Mock DNS resolution
- `ssrfMock` - Mock SSRF validation
- `createMockWebhookManager()` - WebhookManager mock factory
- `createDatasetMock()` - Dataset mock factory

### Test Utilities (`setup/helpers/test-utils.js`)

- `createMockRequest()` - Express Request mock
- `createMockResponse()` - Express Response mock
- `createMockNextFunction()` - Express NextFunction mock
- `assertType<T>()` - Type-safe casting helper
- `getLastAxiosCall(axios, method)` - Get arguments of last axios call
- `getLastAxiosConfig(axios, method)` - Get config object of last axios call

### Lifecycle Helpers (`setup/helpers/test-lifecycle.js`)

- `useMockCleanup()` - Auto-clear mocks in beforeEach
- `useFakeTimers()` - Auto-manage fake timers
- `useConsoleSpy()` - Auto-manage console spies

### Middleware Utilities (`setup/helpers/middleware-test-utils.js`)

- `createMiddlewareTestContext()` - Complete middleware test setup
- `runMiddlewareWithTimers()` - Run middleware with timer support

### Application Utils (`setup/helpers/app-utils.js`)

- `setupTestApp()` - Initialize app and supertest client for integration/E2E tests

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
