---
trigger: model_decision
description: Testing standards and best practices for Jest test suites
globs: tests/**/*.test.js, tests/**/*.spec.js, **/__tests__/**/*.js
---

# Test Development Best Practices

## Directory Structure

- `tests/unit/` - Isolated module tests
- `tests/integration/` - Module interaction tests
- `tests/e2e/` - End-to-end system tests
- `tests/setup/` - Shared helpers, mocks, setup logic

## Always Reuse Helpers

**CRITICAL**: Import from `tests/setup/helpers/` instead of recreating utilities.

```javascript
// ✅ GOOD
import {
  sleep,
  waitForCondition,
  createMockRequest,
  createMockResponse,
  assertType,
} from "../setup/helpers/test-utils.js";
import {
  apifyMock,
  axiosMock,
  createDatasetMock,
  dnsPromisesMock,
} from "../setup/helpers/shared-mocks.js";
import {
  useMockCleanup,
  useFakeTimers,
  useConsoleSpy,
} from "../setup/helpers/test-lifecycle.js";
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";

// ❌ BAD - Never recreate these
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
```

## Available Helpers

### mock-setup.js

- `setupCommonMocks({ axios, apify, dns, ssrf, logger })` - Register mocks BEFORE imports
- `loggerMock` - Shared logger mock for assertions

### shared-mocks.js

- `apifyMock`, `axiosMock`, `dnsPromisesMock`, `ssrfMock` - Pre-configured mocks
- `createDatasetMock(items, { autoRegister })` - Dataset with getData/pushData/getInfo
- `createKeyValueStoreMock(overrides)` - KV store mock
- `createMockWebhookManager(overrides)` - WebhookManager mock
- `setupBasicApifyMock(mockInstance, options)` - Configure apifyMock
- `resetNetworkMocks()` - Reset SSRF, DNS, Axios to defaults

### test-utils.js

- `createMockRequest(overrides)`, `createMockResponse(overrides)`, `createMockNextFunction(fn)`
- `sleep(ms)`, `waitForCondition(condition, timeout, interval)`
- `assertType<T>(value)` - Type-safe casting (use instead of `@type {any}`)
- `getLastAxiosCall(axios, method)`, `getLastAxiosConfig(axios, method)`

### test-lifecycle.js

- `useMockCleanup(additionalSetup)` - Auto-clear mocks in beforeEach
- `useFakeTimers()` - Auto-manage fake timers
- `useConsoleSpy(...methods)` - Auto-manage console spies, returns spy object

### Other Helpers

- `middleware-test-utils.js`: `createMiddlewareTestContext()`, `runMiddlewareWithTimers()`
- `app-utils.js`: `setupTestApp()` - Initialize app + supertest for integration tests
- `db-hooks.js`: `resetDb()` - Clear DuckDB logs table
- `signature-utils.js`: `createStripeSignature()`, `createShopifySignature()`, `createGitHubSignature()`, `createSlackSignature()`

## ESM Mock Mutation

When mocking constants or modules that use `export const`, standard assignments might fail because exports are read-only. Use the following patterns:

### Pattern A: Object.defineProperty (Recommended)

```javascript
import { constsMock } from "../setup/helpers/shared-mocks.js";

Object.defineProperty(constsMock, "DUCKDB_FILENAME", {
  value: ":memory:",
  writable: true,
});
```

### Pattern B: unstable_mockModule Override

Use this for full module behavior override before a fresh import.

```javascript
jest.unstable_mockModule("../../src/consts.js", () => ({
  ...constsMock,
  DUCKDB_FILENAME: ":memory:",
}));

jest.resetModules();
const DuckDB = await import("../../src/db/duckdb.js");
```

## DuckDB Test Isolation

**CRITICAL**: Always close the database in `afterEach` to prevent file locks or memory leaks between tests.

```javascript
describe("DuckDB Tests", () => {
  let DuckDB;

  beforeEach(async () => {
    DuckDB = await import("../../src/db/duckdb.js");
  });

  afterEach(async () => {
    if (DuckDB) await DuckDB.closeDb();
    jest.resetModules();
  });
});
```

## Module Mocking Pattern

```javascript
// TOP of test file, BEFORE other imports:
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
await setupCommonMocks({ axios: true, apify: true, dns: true });

// THEN import module under test:
const { someFunction } = await import("../../src/some-module.js");
const { Actor } = await import("apify"); // Mocked version
```

## Type Safety

```javascript
// ✅ GOOD - Typed mock
const kvStore = {
  getValue: /** @type {jest.Mock<any>} */ (jest.fn()).mockResolvedValue(null),
};

// ✅ GOOD - Use assertType for casting
expect(() => new RateLimiter(assertType("10"), 1000)).toThrow();

// ✅ GOOD - Type variables
/** @type {string} */
let webhookId;
/** @type {AppClient} */
let appClient;
```

## Lifecycle Helpers

```javascript
describe("My Suite", () => {
  const consoleSpy = useConsoleSpy("log", "warn", "error");
  useMockCleanup(() => {
    process.env.MY_VAR = "test-value"; // Additional setup per test
  });
  useFakeTimers(); // Auto-manages timers

  afterEach(() => {
    delete process.env.MY_VAR; // Cleanup env vars
  });

  test("example", () => {
    expect(consoleSpy.error).toHaveBeenCalled();
  });
});
```

## Async Testing

```javascript
// ✅ GOOD - Wait for conditions
await waitForCondition(() => spy.mock.calls.length > 0, 1000, 50);

// ❌ BAD - Arbitrary sleep
await sleep(1000);

// Extended timeout for slow tests
test("slow operation", async () => {
  // ...test code
}, 15000); // 15 second timeout
```

## DNS / SSRF Mocking

```javascript
beforeEach(() => {
  dnsPromisesMock.resolve4.mockReset();
  dnsPromisesMock.resolve6.mockReset();
});

test("should reject internal IP", async () => {
  dnsPromisesMock.resolve4.mockResolvedValue(["10.0.0.1"]);
  dnsPromisesMock.resolve6.mockRejectedValue(new Error("No AAAA"));
  // ...test SSRF protection
});
```

## Common Patterns

### Express Middleware

```javascript
const req = createMockRequest({ body: { test: "data" } });
const res = createMockResponse();
const next = createMockNextFunction();

middleware(req, res, next);
expect(next).toHaveBeenCalled();
```

### Integration Tests with supertest

```javascript
import { setupTestApp } from "../setup/helpers/app-utils.js";

let appClient, teardownApp;
beforeAll(async () => {
  ({ appClient, teardownApp } = await setupTestApp());
});
afterAll(() => teardownApp());

test("GET /health", async () => {
  expect((await appClient.get("/health")).status).toBe(200);
});
```

### Dataset Mocking

```javascript
const mockItem = { id: "evt_1", webhookId, method: "POST", body: "{}" };
jest.mocked(Actor.openDataset).mockResolvedValue(createDatasetMock([mockItem]));
```

### Retry / Resilience Testing

```javascript
// Mock axios to fail twice then succeed
jest
  .mocked(axios)
  .mockRejectedValueOnce({ code: "ECONNABORTED" })
  .mockRejectedValueOnce({ code: "ECONNABORTED" })
  .mockResolvedValueOnce({ status: 200, data: "OK" });

expect(axios).toHaveBeenCalledTimes(3);
```

### Stream Consumption in Mocks

```javascript
// When mocking KVS setValue with streams
setValue: jest.fn().mockImplementation(async (_, value) => {
  if (value && typeof value.resume === "function") {
    value.resume();
    await new Promise((resolve) => value.on("end", resolve));
  }
});
```

### Error Testing

```javascript
await expect(fn()).rejects.toThrow("Specific error");
expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("Error"));

// Test error code matching
const err = /** @type {CommonError} */ (new Error("File not found"));
err.code = "ENOENT";
mockAccess.mockRejectedValue(err);
```

### Mocking node: Prefix

Always mock the `node:` prefixed version of built-ins if the source code uses them.

```javascript
jest.unstable_mockModule("node:fs/promises", () => ({
  ...fsPromisesMock,
  default: fsPromisesMock,
}));
```

## Assertions

```javascript
// ✅ Specific
expect(res.status).toBe(200);
expect(res.body).toHaveProperty("data");
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).toHaveBeenCalledWith(expect.objectContaining({ id: "123" }));
expect(writeFile).toHaveBeenCalledWith(
  expect.stringContaining("INPUT.json"),
  expect.any(String),
  "utf-8",
);

// ❌ Vague
expect(res).toBeTruthy();
```

## Performance & Coverage

- Unit tests < 100ms each; use extended timeouts for slow E2E tests
- Use `waitForCondition` instead of `sleep`
- Mock expensive operations (I/O, network)
- Aim for 90%+ statement, 85%+ branch coverage
- Test edge cases, error paths, and retries

## Running Tests

```bash
npm test                              # All tests
npm test tests/unit/                  # Unit only
npm test -- tests/unit/file.test.js   # Specific file
npm test -- --watch                   # Watch mode
npm run test:coverage                 # Coverage
```
