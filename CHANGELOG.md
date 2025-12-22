# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2025-12-22

### Added

- **v2.2 Comprehensive Robustness Update**:
  - Global Express error handling to catch malformed bodies and unhandled exceptions.
  - Hardened state persistence with try-catch and validation logic.
  - Standardized timeouts (10s) for HTTP Forwarding and Replay APIs.
  - Improved error reporting for Replay API (distinguishes between timeouts and target rejections).
  - Resilient initialization to survive storage-layer transients.

## [2.1.1] - 2025-12-22

### Fixed

- **Hotfix**: Added missing `editor` fields to `input_schema.json` to resolve Apify platform validation errors.

## [2.1.0] - 2025-12-22

### Added

- **v2.1 Custom Scripting**: Allow users to provide JavaScript snippets for advanced data transformation before logging.
- Prepared for $1M Challenge final submission with unified enterprise feature set.

## [2.0.0] - 2025-12-21

### Added

- **v2.0 Enterprise Features**:
  - **Security**: CIDR IP Whitelisting and API Key/Bearer Auth support.
  - **Mocking**: Custom response bodies, status codes, and headers.
  - **Simulation**: Configurable response delay (latency simulation up to 10s).
  - **Workflows**: Real-time HTTP Request Forwarding (pipe webhooks to other APIs).
  - **Replay API**: Endpoint to resend captured events to any destination.
  - **Validation**: JSON Schema validation with professional error reporting.
- New "Enterprise" sections in input schema for easier configuration.

### Improved

- Middleware refactored into a high-performance pipeline.
- Upgraded dependencies: `ajv` for validation and `ip-range-check` for security.

## [1.1.0] - 2025-12-21

### Added

- Narrated walkthrough video integrated into README for Quality Score boost.
- 5+ comprehensive FAQs added to documentation.
- CSV Output Format preview table in README.
- Example values added to Dataset Schema for improved platform documentation.
- Developer Support Guarantee (24h response time) added.

### Improved

- Input Schema sections and tooltips polished for better UX.
- [CRITICAL] Safety checks added to logging middleware to prevent data loss.
- GitHub repository synchronized with finalized production assets.

## [1.0.0] - 2025-12-20

### Added

- Initial release of Webhook Debugger & Logger.
- Standby mode support for sub-10ms response times.
- Real-time event streaming via Server-Sent Events (SSE).
- Dynamic webhook URL generation (1-10 IDs per run).
- /logs API with advanced filtering (method, status, ID).
- Response status code override via `?__status=XXX`.
- Robust body parsing for JSON, XML, and URL-encoded form data.
- Payload size limit (configurable, default 10MB).
- Detailed integration guides for Zapier and Make.
- Table view configuration for Apify Dataset.
- CSV/JSON export links in Output tab.
- PPE (Pay-per-Event) pricing support.
