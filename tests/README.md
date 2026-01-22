# Test Suite Guide

## Overview

This directory contains all test files for the Webhook Debugger & Logger.

## Test Helpers

### Mock Setup (`helpers/mock-setup.js`)

Centralized mock registration. Import BEFORE any source code:

```javascript
import { setupCommonMocks } from "./helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, dns: true });
```

### Shared Mocks (`helpers/shared-mocks.js`)

- `apifyMock` - Mock Apify Actor
- `axiosMock` - Mock axios
- `dnsPromisesMock` - Mock DNS resolution
- `ssrfMock` - Mock SSRF validation
- `createMockWebhookManager()` - WebhookManager mock factory
- `createDatasetMock()` - Dataset mock factory

### Test Utilities (`helpers/test-utils.js`)

- `createMockRequest()` - Express Request mock
- `createMockResponse()` - Express Response mock
- `createMockNextFunction()` - Express NextFunction mock
- `assertType<T>()` - Type-safe casting helper
- `getLastAxiosCall(axios, method)` - Get arguments of last axios call
- `getLastAxiosConfig(axios, method)` - Get config object of last axios call

### Lifecycle Helpers (`helpers/test-lifecycle.js`)

- `useMockCleanup()` - Auto-clear mocks in beforeEach
- `useFakeTimers()` - Auto-manage fake timers
- `useConsoleSpy()` - Auto-manage console spies

### Middleware Utilities (`helpers/middleware-test-utils.js`)

- `createMiddlewareTestContext()` - Complete middleware test setup
- `runMiddlewareWithTimers()` - Run middleware with timer support

## Best Practices

1. **Always use helpers** instead of repeating setup code
2. **Import setupCommonMocks first** in test files
3. **Use lifecycle helpers** for beforeEach/afterEach patterns
4. **Avoid `@type {any}`** - use `assertType<T>()` or proper types
5. **Keep tests isolated** - use `useMockCleanup()`

## Running Tests

```bash
# All tests
npm test

# Specific file
npm test -- middleware.test.js

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
# OR
npm run test:coverage
```
