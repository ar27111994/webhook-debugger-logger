# Conditional Multi-Provider Verification Plan

**Target Release**: v3.x (Future)
**Priority**: Enhancement
**Status**: Planned

---

## Overview

Add first-class support for **conditional signature verification** so a single webhook endpoint can validate requests from different providers, or from custom partner schemes, using deterministic matching rules.

Today, the Actor resolves a single `signatureVerification` object per request and records a single verification result. That model works well when one webhook endpoint is owned by one provider, but it breaks down for shared ingress patterns such as:

- A reverse proxy routing multiple SaaS providers into one Actor endpoint
- A migration period where old and new providers post to the same callback URL
- A partner integration that uses one of several custom HMAC schemes depending on headers, event family, or tenant
- A testing environment where a shared callback URL needs to emulate multiple providers safely

This feature introduces a new rule-driven configuration model, tentatively named `signatureVerificationRules`, that selects **one active verifier per request** based on explicit conditions.

> **Design Principle**: Verification selection must be deterministic, inspectable, and safe. The Actor must never silently “try multiple providers until one passes.”

---

## Design Goals

1. **Single endpoint, multiple providers**: Allow one webhook URL to accept traffic from multiple built-in and custom signature schemes.
2. **Deterministic selection**: Select exactly one verification rule for a request based on match conditions and explicit precedence.
3. **Backward compatibility**: Existing `signatureVerification` behavior must remain valid without migration.
4. **Traceability**: Persist enough metadata to explain which rule matched, which provider was used, and why verification failed.
5. **Security-first semantics**: Avoid ambiguous fallback behavior that could weaken verification or hide misconfiguration.
6. **Hot-reload compatible**: Reuse the existing input/config reload pipeline so rules can be updated without code changes.

---

## Non-Goals

- No “best effort” verification where multiple providers are attempted and the first success wins.
- No user-defined JavaScript for verifier selection in the initial release.
- No multi-result signature verdict stored on a single request in the MVP. One request still produces one final verification result.
- No automatic provider inference from payload body content alone unless explicitly configured through a rule.

---

## Problem Statement

The current implementation supports:

- One global `signatureVerification` object in Actor input
- One per-webhook `signatureVerification` override in internal webhook metadata
- One logged result: `signatureValid`, `signatureProvider`, and `signatureError`

The current model does **not** support:

- Selecting Stripe for some requests and GitHub for others on the same webhook ID
- Switching between built-in and custom verifiers based on request headers
- Handling partner-specific custom schemes for different tenants behind a shared endpoint

Operationally, users can work around this today by using multiple webhook IDs or multiple Actor runs. That workaround is useful, but it does not solve the shared-ingress use case.

---

## User Scenarios

### Scenario 1: Shared Ingress Gateway

A platform team exposes one public callback URL and routes multiple upstream providers into the Actor. The Actor must validate GitHub requests using `X-Hub-Signature-256` and Shopify requests using `X-Shopify-Hmac-Sha256`.

### Scenario 2: Migration Window

A team is migrating from a legacy custom HMAC sender to Stripe. During the cutover window, both systems post to the same URL. The Actor must validate each request using the correct scheme so traffic can be observed and replayed safely.

### Scenario 3: Multi-Tenant Partner Integrations

Tenant A signs with `X-Acme-Signature` using hex, while Tenant B signs with `X-Contoso-Signature` using base64. Both post to the same endpoint. Selection must be driven by a stable request attribute such as header or source path.

---

## Proposed Configuration Model

### New Top-Level Input Field

Add a new optional input field:

```json
{
  "signatureVerificationRules": [
    {
      "id": "github-default",
      "priority": 100,
      "when": {
        "headers": {
          "x-github-event": "*"
        }
      },
      "verify": {
        "provider": "github",
        "secret": "github-secret"
      }
    },
    {
      "id": "shopify-default",
      "priority": 90,
      "when": {
        "headers": {
          "x-shopify-topic": "*"
        }
      },
      "verify": {
        "provider": "shopify",
        "secret": "shopify-secret",
        "tolerance": 300
      }
    },
    {
      "id": "tenant-acme-custom",
      "priority": 80,
      "when": {
        "headers": {
          "x-partner-name": "acme"
        }
      },
      "verify": {
        "provider": "custom",
        "secret": "acme-secret",
        "headerName": "X-Acme-Signature",
        "timestampKey": "X-Acme-Timestamp",
        "algorithm": "sha256",
        "encoding": "hex",
        "tolerance": 300
      }
    }
  ]
}
```

### Rule Shape

Each rule contains:

- `id`: Stable identifier for observability and debugging
- `priority`: Integer precedence where larger values win
- `when`: Match criteria
- `verify`: A normal `SignatureConfig` object using the existing provider model
- `enabled`: Optional boolean, default `true`

### Match Criteria (MVP)

The initial `when` contract should support:

- `headers`: Exact match or wildcard `*`
- `method`: HTTP method match
- `path`: Exact or prefix match on request path
- `query`: Exact query key/value matching

Example:

```json
{
  "id": "slack-interactivity",
  "priority": 100,
  "when": {
    "method": "POST",
    "headers": {
      "x-slack-signature": "*"
    },
    "path": "/webhook/shared"
  },
  "verify": {
    "provider": "slack",
    "secret": "slack-secret"
  }
}
```

### Why Header-Based Matching First

Header-based routing is safer than payload-based routing because:

- It can be evaluated before JSON parsing
- It aligns with how providers expose their identity already
- It avoids selecting a verifier based on untrusted parsed body shape alone

---

## Selection Semantics

### Deterministic Rule Evaluation

The Actor must follow this algorithm:

1. Build the candidate rule list from `signatureVerificationRules`
2. Filter out disabled rules
3. Evaluate `when` conditions against the request
4. Sort matching rules by descending `priority`
5. If exactly one top-priority rule remains, select it
6. If multiple rules share the highest priority and all match, fail closed with a configuration ambiguity error
7. Run exactly one verification pass using the selected rule's `verify` object

### Failure Modes

If no rules match:

- Default behavior in MVP should be configurable:
  - `failClosed`: reject request because a rule was expected but none matched
  - `skipVerification`: preserve current permissive semantics for mixed environments

Recommended default when `signatureVerificationRules` is present: `failClosed`

### Proposed Option

```json
{
  "signatureVerificationMode": "failClosed"
}
```

Valid values:

- `failClosed`
- `skipVerification`

---

## Backward Compatibility

The Actor must support three configuration modes:

### Mode 1: Existing Single Verifier

```json
{
  "signatureVerification": {
    "provider": "stripe",
    "secret": "whsec_..."
  }
}
```

Behavior remains unchanged.

### Mode 2: Rules-Only

```json
{
  "signatureVerificationRules": [ ... ]
}
```

New conditional behavior.

### Mode 3: Hybrid

```json
{
  "signatureVerification": {
    "provider": "github",
    "secret": "fallback-secret"
  },
  "signatureVerificationRules": [ ... ],
  "signatureVerificationMode": "failClosed"
}
```

Recommended semantics:

- If rules exist and a rule matches, use the matched rule
- If rules exist and none match:
  - `failClosed`: reject
  - `skipVerification`: optionally fall back to `signatureVerification` if configured

This hybrid path is useful for gradual adoption but should be clearly documented to avoid hidden behavior.

---

## Data Model Changes

### Event Shape

Add new fields to the logged event model:

```typescript
interface WebhookEvent {
  signatureValid?: boolean;
  signatureProvider?: string;
  signatureError?: string;
  signatureRuleId?: string | null;
  signatureRuleMatched?: boolean;
  signatureSelectionError?: string | null;
}
```

### Why This Matters

The current model can tell the operator that GitHub verification failed, but it cannot explain:

- Which rule selected GitHub
- Whether the failure came from no matching rule vs. bad signature vs. ambiguous configuration

The new fields make troubleshooting straightforward.

### DuckDB Schema Changes

Add columns to the `logs` table:

```sql
ALTER TABLE logs ADD COLUMN signatureRuleId VARCHAR;
ALTER TABLE logs ADD COLUMN signatureRuleMatched BOOLEAN;
ALTER TABLE logs ADD COLUMN signatureSelectionError VARCHAR;
```

This enables queries such as:

- “Show all requests matched by `tenant-acme-custom`”
- “Show requests where verification was skipped because no rule matched”
- “Show configuration ambiguity failures”

---

## API and Dashboard Impact

### Existing APIs

`GET /logs` should support new filters:

- `signatureRuleId`
- `signatureRuleMatched`
- `signatureSelectionError`

### Dashboard

The dashboard signature badge should evolve from “active provider” to one of:

- `Single Provider: STRIPE`
- `Conditional Verification: 3 rules`
- `Conditional Verification Misconfigured`

Per-event views should show:

- Selected rule ID
- Selected provider
- Match mode result

---

## Technical Architecture

### New Components

#### `SignatureRuleEvaluator`

Responsibilities:

- Normalize rule config
- Evaluate `when` conditions against the incoming request
- Return a single selected rule or a structured selection error

Suggested interface:

```typescript
interface SignatureRuleMatchResult {
  matched: boolean;
  ruleId?: string;
  verifyConfig?: SignatureConfig;
  error?: string;
}
```

#### `normalizeSignatureVerificationRules()`

Part of config parsing. Ensures:

- unique `id`
- valid `priority`
- valid `verify.provider`
- required fields for custom provider
- supported matcher keys only

### Integration Point

The selection decision must happen before the current verification call in `LoggerMiddleware`, both in:

- the streaming offload path
- the standard sync verification path

That means the evaluator must be usable from both code paths and must depend only on request metadata available at that stage.

### Why Not `customScript`

`customScript` currently runs after signature verification and response shaping begins. It is the wrong abstraction for verifier selection and should remain that way.

---

## Security Considerations

### 1. No Implicit Multi-Try Verification

The Actor must never attempt multiple verifiers sequentially until one passes. That pattern would:

- make misconfiguration hard to detect
- create surprising accept behavior
- increase attack surface for crafted requests

### 2. Fail Closed on Ambiguity

If two rules match with equal effective priority, reject the request with a clear configuration error.

### 3. Header Normalization

Rules must operate on lowercase normalized headers, matching the current verification behavior.

### 4. Rule Limits

Set safety bounds for rule count in the input schema, for example:

- maximum 50 rules
- maximum 20 header predicates per rule

### 5. Secrets Handling

Each rule may carry a distinct secret, so documentation must strongly recommend environment-backed configuration and minimal retention of exported input files.

---

## Acceptance Criteria

### Functional

1. A request that matches a GitHub rule is verified using GitHub semantics and logs `signatureRuleId=github-default`.
2. A request that matches a Shopify rule is verified using Shopify semantics and logs `signatureRuleId=shopify-default`.
3. A request that matches a custom rule is verified using the configured custom header, algorithm, encoding, and timestamp settings.
4. If two rules match with the same highest priority, the request is rejected and logs `signatureSelectionError`.
5. If no rule matches and mode is `failClosed`, the request is rejected.
6. If no rule matches and mode is `skipVerification`, the request continues without a signature verdict unless a legacy fallback is configured.

### Compatibility Criteria

1. Existing single-provider `signatureVerification` configurations continue to work unchanged.
2. Existing playbooks and examples for Stripe, Shopify, GitHub, Slack, and custom verification remain valid.

### Operability Criteria

1. `GET /logs` can filter by `signatureRuleId`.
2. Operators can identify whether a request failed due to bad signature, no matching rule, or ambiguous selection.

---

## Testing Strategy

### Unit Tests

- Rule normalization
- Header matching
- Method/path/query matching
- priority resolution
- ambiguity detection
- failClosed vs skipVerification behavior

### Middleware Tests

- streaming offload path with selected rule
- standard sync path with selected rule
- event field population for `signatureRuleId` and `signatureSelectionError`
- legacy single-provider path untouched

### Repository Tests

- persistence and filtering of new columns

### End-to-End Tests

- mixed provider traffic against one webhook ID
- migration scenario with old custom sender plus new built-in provider

---

## Implementation Phases

### Phase 1: Core Rule Selection MVP

- Add `signatureVerificationRules`
- Add header/method/path/query matching
- Add deterministic priority-based selection
- Add new event and DB fields
- Add `/logs` filters

### Phase 2: Dashboard and Operator UX

- Show conditional verification status in dashboard
- Display selected rule metadata in log detail views

### Phase 3: Advanced Matchers

- Optional support for exact body-field matching after safe parse
- Optional support for CIDR/source IP rule predicates

### Phase 4: Management API

Expose a rule-management API similar in spirit to the programmable responses roadmap item, if the project wants runtime rule control outside Actor input updates.

---

## Open Questions

1. Should `signatureVerificationRules` be allowed in per-webhook metadata as well as top-level Actor input?
2. Should legacy `signatureVerification` act as an automatic fallback when rules are present, or only when explicitly enabled?
3. Is body-based rule matching needed in the MVP, or is header-driven selection sufficient for the first release?
4. Should `GET /info` expose a summary of configured rules for operators?

---

## Recommendation

Build this feature as a rule-driven selector with **single-verifier execution** and **fail-closed semantics**.

That delivers the real value users want, one endpoint that can safely validate multiple providers, without weakening the security posture or overloading the current event model with ambiguous verification behavior.

It also composes cleanly with the rest of the roadmap:

- It complements [programmable-responses.md](programmable-responses.md) by making ingress validation programmable, not just egress responses.
- It complements [webhook-analytics-api.md](webhook-analytics-api.md) by adding new dimensions for verification diagnostics.
- It fits future observability work in [opentelemetry-integration.md](opentelemetry-integration.md) by creating stable rule and provider attributes for spans and metrics.
