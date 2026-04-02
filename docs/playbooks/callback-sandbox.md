# Callback Sandbox Playbook

Use this playbook when an integration expects an immediate callback response and you want to prototype that response without deploying your full backend first.

## Recommended Quick-Start (JSON)

```json
{
  "urlCount": 1,
  "retentionHours": 24,
  "authKey": "callback-sandbox-key",
  "enableJSONParsing": true,
  "defaultResponseCode": 200,
  "defaultResponseBody": "OK",
  "defaultResponseHeaders": {
    "Content-Type": "text/plain"
  },
  "customScript": "event.statusCode = HTTP_STATUS.ACCEPTED; event.responseHeaders = { 'Content-Type': 'application/json' }; event.responseBody = { ok: true, requestId: req.requestId, method: req.method };"
}
```

## What This Matches in the Current Code

- `customScript` runs inside a sandbox with `event`, a safe subset of `req`, `console`, and `HTTP_STATUS` available.
- The script can override `event.statusCode`, `event.responseBody`, and `event.responseHeaders`.
- Script timeouts and runtime failures are logged, but the request path still completes with the actor's normal response flow.
- Response headers from the script are merged over `defaultResponseHeaders`.

## Good Fit Use Cases

- Slack, bot, or command callbacks that need an immediate JSON response.
- URL verification or challenge-response endpoints.
- Rapid callback prototyping before you connect a real downstream service.

## Investigation Queries That Match the Current API

- All sandboxed responses for the active webhook ID:

```text
GET /logs?webhookId=<your-webhook-id>
```

- Non-default response codes produced by the sandbox:

```text
GET /logs?webhookId=<your-webhook-id>&statusCode=202
```

- Response body inspection for a specific callback:

```text
GET /logs/<log-id>
```

## Common Failure Patterns

| Signal | What it usually means | What to do |
| :----- | :-------------------- | :--------- |
| Script error in logs | The sandbox code threw an exception | Fix the script and resend or replay the callback. |
| Script timeout log | The script exceeded the execution timeout | Reduce the script to simple response shaping and move heavy work elsewhere. |
| Unexpected body shape in the script | The sender posted non-JSON content | Remember that only `application/json` is auto-parsed; form-encoded or binary payloads stay raw. |

## Recommended Workflow

1. Point the callback URL at the actor.
2. Start with a minimal `customScript` that only shapes the response body and headers.
3. Use `/logs` and `/log-stream` to inspect how the caller reacted to the sandboxed response.
4. Use `responseDelayMs` to test timeout budgets and `?__status=500` to test the caller's error path before production cutover.
5. Once the callback contract is stable, replace the sandbox with forwarding or your real receiver.
