---
trigger: model_decision
description: Apify Actors Input/Output Schema Specification (JS)
globs: **/*.js, **/*.json, **/*.html, **/*.css, **/*.jsx
---

## Actor Input Schema

The input schema defines the input parameters for an Actor. It's a JSON object comprising various field types supported by the Apify platform.

### Structure

```json
{
  "title": "<INPUT-SCHEMA-TITLE>",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    /* define input fields here */
  },
  "required": []
}
```

### Example

```json
{
  "title": "E-commerce Product Scraper Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "startUrls": {
      "title": "Start URLs",
      "type": "array",
      "description": "URLs to start scraping from (category pages or product pages)",
      "editor": "requestListSources",
      "default": [{ "url": "https://example.com/category" }],
      "prefill": [{ "url": "https://example.com/category" }]
    },
    "followVariants": {
      "title": "Follow Product Variants",
      "type": "boolean",
      "description": "Whether to scrape product variants (different colors, sizes)",
      "default": true
    },
    "maxRequestsPerCrawl": {
      "title": "Max Requests per Crawl",
      "type": "integer",
      "description": "Maximum number of pages to scrape (0 = unlimited)",
      "default": 1000,
      "minimum": 0
    },
    "proxyConfiguration": {
      "title": "Proxy Configuration",
      "type": "object",
      "description": "Proxy settings for anti-bot protection",
      "editor": "proxy",
      "default": { "useApifyProxy": false }
    },
    "locale": {
      "title": "Locale",
      "type": "string",
      "description": "Language/country code for localized content",
      "default": "cs",
      "enum": ["cs", "en", "de", "sk"],
      "enumTitles": ["Czech", "English", "German", "Slovak"]
    }
  },
  "required": ["startUrls"]
}
```

## Actor Output Schema

The Actor output schema builds upon the schemas for the dataset and key-value store. It specifies where an Actor stores its output and defines templates for accessing that output. Apify Console uses these output definitions to display run results.

### Structure

```json
{
  "actorOutputSchemaVersion": 1,
  "title": "<OUTPUT-SCHEMA-TITLE>",
  "properties": {
    /* define your outputs here */
  }
}
```

### Example

```json
{
  "actorOutputSchemaVersion": 1,
  "title": "Output schema of the files scraper",
  "properties": {
    "files": {
      "type": "string",
      "title": "Files",
      "template": "{{links.apiDefaultKeyValueStoreUrl}}/keys"
    },
    "dataset": {
      "type": "string",
      "title": "Dataset",
      "template": "{{links.apiDefaultDatasetUrl}}/items"
    }
  }
}
```

### Output Schema Template Variables

- `links` (object) - Contains quick links to most commonly used URLs
- `links.publicRunUrl` (string) - Public run url in format `https://console.apify.com/view/runs/:runId`
- `links.consoleRunUrl` (string) - Console run url in format `https://console.apify.com/actors/runs/:runId`
- `links.apiRunUrl` (string) - API run url in format `https://api.apify.com/v2/actor-runs/:runId`
- `links.apiDefaultDatasetUrl` (string) - API url of default dataset in format `https://api.apify.com/v2/datasets/:defaultDatasetId`
- `links.apiDefaultKeyValueStoreUrl` (string) - API url of default key-value store in format `https://api.apify.com/v2/key-value-stores/:defaultKeyValueStoreId`
- `links.containerRunUrl` (string) - URL of a webserver running inside the run in format `https://<containerId>.runs.apify.net/`
- `run` (object) - Contains information about the run same as it is returned from the `GET Run` API endpoint
- `run.defaultDatasetId` (string) - ID of the default dataset
- `run.defaultKeyValueStoreId` (string) - ID of the default key-value store
