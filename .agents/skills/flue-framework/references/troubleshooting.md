# Troubleshooting

## Common Failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| New agent or workflow is not discovered | File is nested, wrong source root exists, or filename is not in discovered root | Check `.flue/`, `src/`, then root. Keep discovered modules flat. |
| Adding `.flue/` hides `src/` modules in this repo | Flue stops at first source root | Do not add `.flue/` here unless migrating the whole repo. |
| GitHub channel handler cannot find expected fields | The handler assumed a normalized payload instead of native GitHub webhook fields | Branch on `delivery.name` and read `delivery.payload` using GitHub's own nesting, such as `payload.repository.owner.login` and `payload.issue.number`. |
| GitHub webhook retries or duplicate dispatches repeat work | The GitHub channel is stateless and does not deduplicate delivery IDs | Claim `delivery.deliveryId` in application storage before dispatch when duplicate admission matters. |
| GitHub webhook times out before agent work finishes | Handler waited for long-running model or workflow work | Admit durable work quickly and return a `2xx`; GitHub expects a response within ten seconds. |
| Cloudflare build rejects `db.ts` | Cloudflare target uses Durable Object SQLite automatically | Remove `db.ts`; configure persistence through Durable Objects and migrations. |
| Cloudflare deploy complains about Durable Object classes | Missing, rewritten, or reordered migrations | Append a new migration with generated class names and `FlueRegistry`; do not edit deployed entries. |
| Workers AI `cloudflare/...` model fails | Missing `AI` binding or wrong target/provider path | Add Wrangler `ai.binding = "AI"` and build with Cloudflare target. |
| Provider API key works locally but not deployed | Secret is only in `.env` | Add a Wrangler secret or platform variable. |
| Imported skill is unavailable | `SKILL.md` was not imported with `with { type: "skill" }` or not passed to `skills` | Import the skill and include it in `createAgent({ skills })`. |
| Initialization fails on duplicate skill names | Imported and workspace-discovered skills declare same name | Rename one skill or remove one source. |
| Tool leaks access across tenants | Model chose tenant/account/credential parameter | Move authorization and credentials into trusted application code. |
| Workflow retry repeats external side effects | Flue does not automatically dedupe application effects | Add application idempotency keys around API writes. |
| Direct agent prompt has no run record | Direct agent interactions are session operations, not workflow runs | Use workflows for run history, or inspect session/event surfaces appropriate to agents. |
| `flue run` or `flue connect` fails on Cloudflare target | These commands support Node-local execution only | Use `flue dev --target cloudflare` and call routes. |
| WebSocket client fails behind route prefix | SDK `baseUrl` or WebSocket URL lacks mount path/auth transform | Include the prefix in `baseUrl` and configure `websocketUrl` if needed. |
| `harness.shell(...)` does not run Linux commands on Cloudflare Shell | Cloudflare Shell exposes structured code tool, not arbitrary shell | Use Cloudflare Sandbox for full Linux shell. |
| Persisted conversation exists but files disappeared | Database persistence is separate from sandbox filesystem lifecycle | Use a durable workspace or container-backed sandbox. |
| Telemetry leaks prompt or result content | Exporter includes unsanitized events | Add a `sanitize(event)` policy and omit sensitive content. |
| Sentry reports nothing on Cloudflare Durable Object work | Generated agent/workflow class was not wrapped | Add module-local `cloudflare = extend({ wrap })` and call `instrumentDurableObjectWithSentry(...)`. |
| Top-level webhook or Hono route errors miss Sentry | Only Durable Objects are wrapped | Wrap the authored Worker app with `Sentry.withSentry(...)` when HTTP ingress needs instrumentation. |
| Sentry incidents duplicate nested tool failures and workflow failures | Exporter reports every nested failed operation | Report terminal workflow `run_end` failures and explicit error logs by default. |

## Build Diagnostics To Check

- Missing target: set `target` in `flue.config.ts` or pass `--target`.
- Invalid source names: use lower-kebab-case for discovered agent/workflow filenames.
- Duplicate module names: avoid duplicate filenames across discovered surfaces.
- Invalid generated exports: do not export unsupported top-level symbols from discovered modules.
- Imported skill packaging: remove unsafe symlinks and sensitive files from imported skill directories.
- Cloudflare requirements: `nodejs_compat`, Wrangler availability, reserved binding names, Durable Object migrations, and target package availability.

## Security Checklist

- Authenticate in `app.ts`, workflow `route`, or application-owned webhook routes before admitting work.
- Authorize selected agent `id`, workflow run, repository, account, or tenant.
- Do not expose admin routes without authorization.
- Keep provider keys, GitHub tokens, Sentry DSNs, and Cloudflare tokens in environment or platform secrets.
- Do not put secrets in skills, instructions, fixtures, source code, or model-visible tool parameters.
- Treat workflow payloads, run records, agent submissions, events, and traces as sensitive retained data.

## Cloudflare Recovery Interpretation

- A lost HTTP/SSE/WebSocket connection does not necessarily cancel accepted direct agent work.
- Direct and dispatched agent inputs share the same same-session ordering.
- Flue retries after interruption only when it can prove provider work did not cross the input-application boundary.
- Interrupted Cloudflare workflow runs are marked errored; retry is an application decision.
- `run_resume` before `run_end` means terminal recovery handling, not resumed workflow code.

## When To Re-read Official Docs

Re-check upstream docs before changing:

- Flue version, `@flue/runtime`, or `@flue/cli` major/minor behavior.
- Cloudflare Durable Object migration syntax.
- Cloudflare Sandbox, Shell, Workers AI, or AI Gateway configuration.
- Ecosystem channel behavior, especially webhook payloads, delivery timing, and deduplication.
- Provider registration protocols.
- SDK route contracts or WebSocket message shapes.
