# Changelog

All notable changes to this project will be documented in this file.

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
