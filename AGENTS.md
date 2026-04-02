---
name: Agent Guide
description: Agent guide for Webhook Debugger & Logger codebase
---

# Agent Guide: Webhook Debugger & Logger

This document provides essential information for agents working in this repository.

## Project Overview

- **Type**: Apify Actor (Node.js/Express)
- **Language**: JavaScript with JSDoc type annotations
- **Runtime**: Node.js 18+
- **Storage**: Apify Dataset + DuckDB (read model)

## Commands

### Test Commands

```bash
# All tests
npm test

# Run specific test file
npm test -- tests/unit/rate_limiter.test.js

# Unit tests only
npm test tests/unit/

# Integration tests
npm test tests/integration/

# E2E tests
npm test tests/e2e/

# With coverage (requires 90% threshold)
npm test -- --coverage
npm run test:coverage

# Stress tests
npm run test:stress

# Watch mode
npm test -- --watch
```

### Linting & Type Checking

```bash
# Lint all source
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Type check (TypeScript-style checking for JS)
npm run typecheck

# Format code
npm run format

# Check formatting without changes
npm run format:check
```

### Apify Commands

```bash
# Run locally
apify run

# Deploy to Apify
apify push
```

## Code Style Guidelines

### File Organization

- Each file should have a header comment block:

```javascript
/**
 * @file src/path/to/file.js
 * @description Brief description of file purpose
 * @module module/path
 */
```

### Imports

- Group imports: external libs → internal modules → utilities
- Use named exports for all modules
- Use ES modules (`import { x } from './module.js'`)

### Types (JSDoc)

This project uses JSDoc with strict TypeScript checking:

- Define shared types in `src/typedefs.js`
- Use `@typedef` for complex object shapes
- Use `@param` and `@returns` for all functions
- Import types with `@typedef {import('./path').TypeName}`

```javascript
/** @typedef {import('./typedefs.js').WebhookEvent} WebhookEvent */

/**
 * @param {WebhookEvent} event
 * @returns {string}
 */
function processEvent(event) { ... }
```

### Naming Conventions

- **Classes**: PascalCase (`LogRepository`, `CircuitBreaker`)
- **Functions/variables**: camelCase (`executeQuery`, `findLogs`)
- **Constants**: UPPER_CASE in `src/consts/` files
- **Private methods**: Prefix with `#` (class fields, e.g., `#buildWhereClause`)

### Error Handling

- Use centralized error handler middleware
- Log errors with structured logging (Pino)
- Sanitize error responses (never expose internal details for 5xx errors)
- Use typed error objects with `@typedef {import('./typedefs.js').CommonError}`

### SQL Security

- NEVER concatenate user input into SQL queries
- ALWAYS use parameterized queries (`$paramName`)
- Whitelist fields in SELECT statements
- Validate and sanitize JSON paths before use

### Testing Patterns

- Import `setupCommonMocks` BEFORE source code
- Use shared helpers from `tests/setup/helpers/`
- Prefer `waitForCondition` over `sleep()`
- Use `assertType<T>()` instead of `@type {any}`
- Always close DuckDB in `afterEach` to prevent file locks

## Architecture Patterns

### Repository Pattern

- Database access goes through `src/repositories/`
- SQL queries use parameterized statements
- Results are mapped to typed objects

### Service Layer

- Business logic in `src/services/`
- Use circuit breaker pattern for external calls

### Middleware

- Express middleware in `src/middleware/`
- Error handler should be last middleware

### Constants

- All constants in `src/consts/`
- Use index files for exporting related constants

## Key Files

| Path                                | Purpose                 |
| ----------------------------------- | ----------------------- |
| `src/main.js`                       | Actor entry point       |
| `src/typedefs.js`                   | Shared type definitions |
| `src/repositories/LogRepository.js` | DuckDB data access      |
| `src/db/duckdb.js`                  | Database connection     |
| `src/routes/`                       | Express API routes      |
| `src/services/`                     | Business logic          |
| `src/consts/`                       | All constants           |
| `tests/setup/helpers/`              | Test utilities          |

## Database (DuckDB)

- Use parameterized queries to prevent SQL injection
- Convert BigInt to Number for JSON serialization
- Define schema in SQL constants files
- Tests must close DB connection in `afterEach`

## Dependencies

- **Runtime**: Express, Apify SDK, axios, DuckDB
- **Dev**: Jest, ESLint, Prettier, TypeScript
- **Linting**: ESLint with sonarjs plugin (strict)
- **Formatting**: Prettier (enforce with pre-commit hook)

## Important Notes

1. The project uses JSDoc with TypeScript strict mode (`tsconfig.json` has `checkJs: true`)
2. All tests run with `--runInBand` (sequential) to avoid DB conflicts
3. ESLint rules: no magic numbers (except -1, 0, 1), no undefined variables
4. Tests have 90% coverage threshold
5. Use `useMockCleanup()` for proper mock isolation
