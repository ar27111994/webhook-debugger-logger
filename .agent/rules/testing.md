---
trigger: model_decision
description: Testing standards and best practices for Jest test suites
globs: tests/**/*.test.js, tests/**/*.spec.js, **/__tests__/**/*.js
---

# Test Development Best Practices

## Test Organization

- Use descriptive `describe` blocks to group related tests
- Keep test names clear and specific (what is being tested, expected outcome)
- Follow AAA pattern: Arrange, Act, Assert
- One assertion concept per test (but multiple expects for related checks OK)
- Use `beforeEach` and `afterEach` for test isolation
- Never skip cleanup in `afterEach` - always restore spies and reset mocks

## Shared Test Utilities

### Always Reuse Existing Helpers

- Import and use `sleep` and `waitForCondition` from `./helpers/test-utils.js`
- Use `createMockRequest`, `createMockResponse`, `createMockNextFunction` from test-utils
- Reuse `apifyMock`, `axiosMock`, `dnsPromisesMock` from `./helpers/shared-mocks.js`
- Use `createApifyMock` for custom Actor mock configurations
- Use `createDatasetMock` for dataset-specific tests

### Never Reinvent

```javascript
// ✅ GOOD - Reuse existing utilities
import { sleep, waitForCondition } from "./helpers/test-utils.js";
import { apifyMock } from "./helpers/shared-mocks.js";

// ❌ BAD - Creating new sleep/wait functions
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

## Type Safety in Tests

### Always Add JSDoc Types

```javascript
// ✅ GOOD - Proper typing
/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 */

/** @type {Request} */
let req;
/** @type {Response} */
let res;
/** @type {jest.SpiedFunction<(...args: any[]) => void>} */
let consoleErrorSpy;
```

### Type Mock Returns

```javascript
// ✅ GOOD - Typed mock
const kvStore = {
  getValue: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(null),
  setValue: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(
    undefined,
  ),
};

// ❌ BAD - Untyped
const kvStore = {
  getValue: jest.fn().mockResolvedValue(null),
  setValue: jest.fn().mockResolvedValue(undefined),
};
```

## Mock Management

### Module-Level Mocking

- Use `jest.unstable_mockModule` before imports
- Mock dependencies BEFORE importing the module under test
- Keep mock setup at top of test file for clarity

### Mock Lifecycle

```javascript
beforeEach(() => {
  jest.clearAllMocks(); // Clear call history

  // Reset mock implementations
  apifyMock.init.mockResolvedValue(undefined);
  apifyMock.getInput.mockResolvedValue({});
});

afterEach(() => {
  // Restore spies
  consoleErrorSpy.mockRestore();

  // Reset all mocks
  jest.resetAllMocks();
});
```

## Async Testing

### Use waitForCondition for Polling

```javascript
// ✅ GOOD - Wait for async conditions
await waitForCondition(
  () => consoleLogSpy.mock.calls.length > 0,
  1000, // timeout
  50, // interval
);

// ❌ BAD - Arbitrary sleep
await sleep(1000); // How do you know 1000ms is enough?
```

### Handle Promises Properly

```javascript
// ✅ GOOD - Proper async/await
test("should handle async operation", async () => {
  await someAsyncOperation();
  expect(result).toBeDefined();
});

// ❌ BAD - Missing await
test("should handle async operation", async () => {
  someAsyncOperation(); // Will pass before promise resolves!
  expect(result).toBeDefined();
});
```

## Test Isolation

### Environment Variables

```javascript
beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv; // Always restore
  delete process.env.TEMP_VAR; // Clean up test vars
});
```

### Fake Timers

```javascript
test("should handle timeout", async () => {
  jest.useFakeTimers();

  // Test code with timers
  await jest.advanceTimersByTimeAsync(1000);

  jest.useRealTimers(); // CRITICAL: Always restore
});
```

## Integration vs Unit Tests

### Integration Tests

- Test full request/response cycles with `supertest`
- Minimal mocking - only external services
- Test authentication, middleware chains, error handling
- File naming: `integration_*.test.js`

### Unit Tests

- Test individual functions/classes in isolation
- Mock all dependencies
- Fast execution
- File naming: matches source file or `unit_*.test.js`

## Assertions Best Practices

### Specific Assertions

```javascript
// ✅ GOOD - Specific expectations
expect(response.status).toBe(200);
expect(response.body).toHaveProperty("data");
expect(Array.isArray(response.body.data)).toBe(true);

// ❌ BAD - Too vague
expect(response).toBeTruthy();
```

### Error Testing

```javascript
// ✅ GOOD - Test specific error
await expect(someFunction()).rejects.toThrow("Specific error message");

// ✅ GOOD - Test error with matcher
expect(consoleErrorSpy).toHaveBeenCalledWith(
  expect.stringContaining("Error prefix"),
);

// ❌ BAD - Catching all errors
try {
  await someFunction();
} catch (e) {
  expect(e).toBeDefined(); // Too vague!
}
```

## Common Patterns

### Testing Express Middlewares

```javascript
const { createMockRequest, createMockResponse, createMockNextFunction } =
  await import("./helpers/test-utils.js");

let req, res, next;

beforeEach(() => {
  req = createMockRequest({ body: { test: "data" } });
  res = createMockResponse();
  next = createMockNextFunction();
});

test("should call next()", () => {
  middleware(req, res, next);
  expect(next).toHaveBeenCalled();
});
```

### Testing Async Functions

```javascript
test("should process data async", async () => {
  const result = await processData(input);

  expect(result).toBeDefined();
  expect(result.status).toBe("success");
});
```

### Testing Error Paths

```javascript
test("should handle errors gracefully", async () => {
  mockFn.mockRejectedValueOnce(new Error("Test error"));

  await expect(functionUnderTest()).rejects.toThrow("Test error");
  // OR
  await functionUnderTest();
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining("Test error"),
  );
});
```

## Performance

- Keep unit tests under 100ms each
- Use `test.concurrent` for independent tests
- Avoid unnecessary `sleep()` - use `waitForCondition` instead
- Mock expensive operations (file I/O, network calls)

## Coverage

- Aim for 90%+ statement coverage
- Aim for 85%+ branch coverage
- Test edge cases: null, undefined, empty arrays, boundaries
- Test error paths, not just happy paths
- Don't test implementation details, test behavior

## Debugging Tests

- Use `test.only()` to isolate failing tests
- Use `console.log` liberally during development (remove after)
- Check mock call counts: `expect(mockFn).toHaveBeenCalledTimes(1)`
- Verify mock call arguments: `expect(mockFn).toHaveBeenCalledWith(...)`
- Run with `--verbose` flag for detailed output
