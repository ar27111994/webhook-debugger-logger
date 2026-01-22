# Architecture Guide

This project follows an Object-Oriented Programming (OOP) architecture to ensure modularity, testability, and type safety.

## Core Components

### 1. `LoggerMiddleware` (`src/logger_middleware.js`)

The heart of the application. It captures, validates, and processes incoming webhooks.

- **Responsibilities**: Request validation, signature verification, custom script execution, and response mocking.
- **State**: Manages compilation of JSON schemas and custom scripts, re-compiling only when input changes.

### 2. `AppState` (`src/utils/app_state.js`)

Manages the global runtime state of the application.

- **Responsibilities**: Central config store, hot-reload orchestration, and dependency management for `main.js`.
- **Hot Reloading**: The `applyConfigUpdate` method atomically updates all dependent components (rate limiters, middleware options, auth keys) when `INPUT.json` changes.

### 3. `HotReloadManager` (`src/utils/hot_reload_manager.js`)

Abstracts the environment-specific hot-reload mechanism.

- **Apify Platform**: Polls the Key-Value store.
- **Local Development**: Watches `storage/key_value_stores/default/INPUT.json` via `fs.watch`.

### 4. `WebhookManager` (`src/webhook_manager.js`)

Manages the lifecycle of dynamic webhook URLs.

- **Persistence**: Saves state to `WEBHOOK_STATE` in the Key-Value store.
- **Scaling**: Adding new URLs dynamically without restarting.

## Data Flow

1. **Initialization**: `main.js` initializes `AppState` and `HotReloadManager`.
2. **Request**: Express routes the request to `LoggerMiddleware`.
3. **Processing**: Middleware validates signatures, runs custom scripts, and logs the event.
4. **Update**: If `INPUT.json` changes, `HotReloadManager` triggers `AppState.applyConfigUpdate`, which refreshes the middleware and rate limiters in real-time.
