# Persistence And Observability

## Database State

Flue stores runtime state, not application business data.

| Stored by Flue | Not stored by Flue |
| --- | --- |
| Agent session messages and compaction state | Sandbox files and installed dependencies |
| Accepted direct prompts and `dispatch(...)` submissions | External API side effects |
| Workflow-run records and persisted events | Business records unless tools store them |
| Run indexing for `/runs` and admin listing | Provider credentials or secrets |

Node target:

- Add source-root `db.ts` for restart persistence.
- Use `sqlite("./data/flue.db")` for local or single-host state.
- Use `@flue/postgres` for host replacement or multi-replica deployments.
- Without `db.ts`, Node uses in-memory state that disappears on process exit.

Cloudflare target:

- Do not add `db.ts`; builds reject it.
- Generated agent and workflow Durable Objects use SQLite automatically.
- `FlueRegistry` indexes workflow runs across the deployment.

## Durable Execution

Addressable agents:

- Direct HTTP/SSE/WebSocket prompts and `dispatch(...)` inputs enter a per-session queue.
- If the client disconnects after admission, backend work may continue.
- Flue requeues after interruption only when it can prove input was not applied.
- If replay safety is uncertain, Flue records an interruption advisory instead of risking duplicate model or tool work.

Workflows:

- Each invocation creates a workflow run with `runId`.
- Interrupted Cloudflare workflow runs are terminalized as errored; Flue does not automatically retry or continue workflow code from checkpointed steps.
- Callers or application code must decide whether to invoke a new run.
- Use application idempotency keys around external side effects when retries are possible.

Use Cloudflare Workflows, not Flue workflow code alone, when the job requires durable step-level continuation.

## Run Inspection

Use these surfaces for workflow runs:

| Surface | Use |
| --- | --- |
| `flue logs <runId>` | CLI replay/follow events. |
| `GET /runs/<runId>` | Run status, result, or error. |
| `GET /runs/<runId>/events` | Persisted lifecycle and operation events. |
| `GET /runs/<runId>/stream` | SSE replay and follow. |
| SDK `client.runs.*` | Application tooling. |
| SDK `client.admin.runs.*` | Protected run listing/get. |

Only workflows create workflow runs. Direct agent prompts and dispatched inputs are persistent agent session operations, not run-history records.

## Events

Useful event families:

- Lifecycle: `run_start`, `run_resume`, `run_end`, `agent_start`, `agent_end`, `idle`.
- Operations: `operation_start`, `operation`, `task_start`, `task`.
- Model turns: `turn_start`, `turn_request`, `turn_end`, `turn`, message and text delta events.
- Tools: `tool_start`, `tool_call`.
- Compaction and logging events.

Use event streams for debugging, progress UIs, and telemetry export. Treat event content as sensitive unless sanitized.

## Observability

Flue emits structured events and can export telemetry to OpenTelemetry-compatible systems, including Sentry integrations in Cloudflare code.

Guidelines:

- Attach application trace context at the HTTP boundary when correlating external requests.
- Treat `run_resume` followed by `run_end` as terminal recovery handling, not resumed workflow code.
- Sanitize event content before exporting prompts, model output, tool arguments, payloads, or results.
- Export unsanitized content only when the destination is approved for that data.

In this repo, Sentry Durable Object instrumentation belongs in module-local `cloudflare = extend({ wrap })` exports, with shared options in `lib/sentry.ts`.

## Errors

Public transport errors use `{ error: FluePublicError }` with stable categories such as:

- `method_not_allowed`
- `unsupported_media_type`
- `invalid_json`
- `agent_not_found`
- `workflow_not_found`
- `workflow_not_http`
- `route_not_found`
- `run_not_found`
- `run_store_unavailable`
- `run_registry_unavailable`
- `invalid_request`
- `validation_failed`
- `internal_error`

Runtime exception messages and generated target internals are human diagnostics, not stable public contracts.
