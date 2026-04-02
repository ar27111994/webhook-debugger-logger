# Canary Validation & Shadow Replay Playbook

Use this playbook when you need to validate a new receiver, parser, or downstream service against real traffic before you fully cut over.

## Important Limitation to Know First

The current actor does not fan out one live request to multiple `forwardUrl` targets at the same time. The supported rollout pattern is:

1. Capture real traffic once.
2. Replay selected events to the canary receiver.
3. Cut over `forwardUrl` when the canary is ready.

## Recommended Quick-Start (JSON)

```json
{
  "urlCount": 2,
  "retentionHours": 72,
  "authKey": "rollout-key",
  "enableJSONParsing": true,
  "maskSensitiveData": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "{\"accepted\":true}",
  "forwardUrl": "https://primary.example.com/webhooks",
  "forwardHeaders": true,
  "replayMaxRetries": 3,
  "replayTimeoutMs": 10000
}
```

## What This Matches in the Current Code

- `urlCount` can generate multiple active webhook IDs, which helps you separate baseline and rollout traffic.
- Replay preserves the original captured method and payload.
- Ordinary forwarding posts to the configured `forwardUrl`.
- The app state layer hot-reloads forwarding and replay settings when the actor input changes.

## Investigation Queries That Match the Current API

- Baseline traffic for one webhook ID:

```text
GET /logs?webhookId=<primary-webhook-id>
```

- Downstream forwarding failures during rollout:

```text
GET /logs?webhookId=<primary-webhook-id>&method=SYSTEM
```

- Latency-sensitive events for manual replay sampling:

```text
GET /logs?webhookId=<primary-webhook-id>&processingTime[gte]=1000
```

## Recommended Workflow

1. Keep the actor forwarding live traffic to the current primary target.
2. Capture representative events from the live stream.
3. Replay a sample set into the canary target:

```bash
curl -X POST \
  "https://<your-actor-host>/replay/<webhookId>/<logId>?url=https%3A%2F%2Fcanary.example.com%2Fwebhooks"
```

1. Compare the canary's behavior against the original captured event set.
1. Update the actor input to switch `forwardUrl` to the canary target once you are satisfied. The current runtime state layer supports hot updates for forwarding-related options.

## Common Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| Replay succeeds but live cutover fails | The canary only saw sampled traffic, not the full production variety | Increase the replay sample set before switching `forwardUrl`. |
| `method=SYSTEM` errors after cutover | The new receiver is failing after the sender already got a 2xx from the actor | Roll back `forwardUrl`, fix the receiver, and replay the missed events. |
| Unexpected method differences | You compared replay to ordinary forwarding without noting the delivery mode | Remember that replay preserves the original method, while live forwarding posts to `forwardUrl`. |
