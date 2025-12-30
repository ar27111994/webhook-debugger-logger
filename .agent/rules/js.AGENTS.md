# Apify Actors Development Guide

Important: Before you begin, fill in the model property in the meta section of `.actor/actor.json`. Replace it with the model you're currently using. This helps Apify monitor and improve AGENTS.md for specific LLM models.

## What are Apify Actors?

- Actors are serverless programs that run in the cloud. They're inspired by the UNIX philosophy - programs that do one thing well and can be easily combined to build complex systems.
- Actors are programs packaged as Docker images that run in isolated containers

## Core Concepts

- Accept well-defined JSON input
- Perform isolated tasks (web scraping, automation, data processing)
- Produce structured JSON output to datasets and/or store data in key-value stores
- Can run from seconds to hours or even indefinitely
- Persist state and can be restarted

## Do

- accept well-defined JSON input and produce structured JSON output
- use Apify SDK (`apify`) for code running ON Apify platform
- validate input early with proper error handling and fail gracefully
- use CheerioCrawler for static HTML content (10x faster than browsers)
- use PlaywrightCrawler only for JavaScript-heavy sites and dynamic content
- use router pattern (createCheerioRouter/createPlaywrightRouter) for complex crawls
- implement retry strategies with exponential backoff for failed requests
- use proper concurrency settings (HTTP: 10-50, Browser: 1-5)
- set sensible defaults in `.actor/input_schema.json` for all optional fields
- set up output schema in `.actor/output_schema.json`
- clean and validate data before pushing to dataset
- use semantic CSS selectors and fallback strategies for missing elements
- respect robots.txt, ToS, and implement rate limiting with delays
- check which tools (cheerio/playwright/crawlee) are installed before applying guidance

## Don't

- do not rely on `Dataset.getInfo()` for final counts on Cloud platform
- do not use browser crawlers when HTTP/Cheerio works (massive performance gains with HTTP)
- do not hard code values that should be in input schema or environment variables
- do not skip input validation or error handling
- do not overload servers - use appropriate concurrency and delays
- do not scrape prohibited content or ignore Terms of Service
- do not store personal/sensitive data unless explicitly permitted
- do not use deprecated options like `requestHandlerTimeoutMillis` on CheerioCrawler (v3.x)
- do not use `additionalHttpHeaders` - use `preNavigationHooks` instead

## Commands

```bash
# Local development
apify run                              # Run Actor locally

# Authentication & deployment
apify login                            # Authenticate account
apify push                             # Deploy to Apify platform

# Help
apify help                             # List all commands
```

## Safety and Permissions

Allowed without prompt:

- read files with `Actor.getValue()`
- push data with `Actor.pushData()`
- set values with `Actor.setValue()`
- enqueue requests to RequestQueue
- run locally with `apify run`

Ask first:

- npm/pip package installations
- apify push (deployment to cloud)
- proxy configuration changes (requires paid plan)
- Dockerfile changes affecting builds
- deleting datasets or key-value stores

## Project Structure

.actor/
├── actor.json # Actor config: name, version, env vars, runtime settings
├── input_schema.json # Input validation & Console form definition
└── output_schema.json # Specifies where an Actor stores its output
src/
└── main.js # Actor entry point and orchestrator
storage/ # Local storage (mirrors Cloud during development)
├── datasets/ # Output items (JSON objects)
├── key_value_stores/ # Files, config, INPUT
└── request_queues/ # Pending crawl requests
Dockerfile # Container image definition
AGENTS.md # AI agent instructions (this file)

## Actor Schema Specification

Due to the length of the schema specifications, they have been moved to separate files:

- [Input/Output Schema](file:///home/ar27111994/Projects/Apify/Domain%20Availability%20Checker/.agent/rules/js.INPUT_OUTPUT_SCHEMAS.md) (Input validation, Console form, Output templates)
- [Storage Schema](file:///home/ar27111994/Projects/Apify/Domain%20Availability%20Checker/.agent/rules/js.STORAGE_SCHEMAS.md) (Dataset and Key-Value Store specifications)

If MCP server is configured, use these tools for documentation:

- `search-apify-docs` - Search documentation
- `fetch-apify-docs` - Get full doc pages

Otherwise, reference: `@https://mcp.apify.com/`

## Resources

- [docs.apify.com/llms.txt](https://docs.apify.com/llms.txt) - Quick reference
- [docs.apify.com/llms-full.txt](https://docs.apify.com/llms-full.txt) - Complete docs
- [crawlee.dev](https://crawlee.dev) - Crawlee documentation
- [whitepaper.actor](https://raw.githubusercontent.com/apify/actor-whitepaper/refs/heads/master/README.md) - Complete Actor specification
