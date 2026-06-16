# Sentry Observability

Use Sentry when a Flue app should report workflow failures and explicit error logs without exporting model content by default.

## Choose Sentry

Choose Sentry when the goal is actionable errors and correlation, not full content-bearing agent traces.

| Need | Prefer |
| --- | --- |
| Workflow failures and explicit error logs | Sentry |
| Vendor-neutral trace export | OpenTelemetry |
| Content-bearing model traces and eval debugging | Braintrust |

Sentry captures should include `flue.*` correlation tags such as run id, instance id, dispatch id, event index, workflow name, operation id, turn id, task id, harness, and session when available.

## Install And Configure

- Prefer `flue add tooling sentry` for the blueprint.
- Keep `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE` in environment or platform secrets.
- A Sentry DSN permits event submission; do not commit it.
- The blueprint does not enable traces, AI metrics, or model-content export by default.

Target packages:

| Target | Package | Boundary |
| --- | --- | --- |
| Node.js | `@sentry/node` | Module-scoped `Sentry.init(...)` in application source. |
| Cloudflare | `@sentry/cloudflare` | `instrumentDurableObjectWithSentry(...)` around generated agent/workflow Durable Objects. |

Do not use `@sentry/node` on Cloudflare through `nodejs_compat`.

## Flue Event Bridge

Register an `observe(...)` bridge once from the application entrypoint.

Report:

- `run_end` where `isError` is true.
- `log` where `level === "error"` and `attributes.error` exists as an exception.
- Other error logs as error-level Sentry messages.

Do not report every failed model turn, operation, or tool call by default. Agents may recover from nested failures, and reporting both nested failures and the terminal workflow failure creates duplicate incidents.

Do not export arbitrary log attributes, workflow payloads, prompts, responses, tool arguments, tool results, or complete events unless the destination is approved for that data and the exporter sanitizes it.

## Cloudflare Wrapping

On Cloudflare, Flue owns generated Durable Object classes. Use module-local `cloudflare = extend({ wrap })` in every discovered agent or workflow that should be instrumented:

```ts
export const cloudflare = extend({
  wrap: (Final) =>
    Sentry.instrumentDurableObjectWithSentry(
      (env: Env) => getSentryOptions(env),
      Final,
    ),
});
```

The Durable Object wrapper preserves Flue routing and durability behavior. It does not cover the outer Worker or authored Hono application. Add `Sentry.withSentry(...)` around the top-level Worker app when HTTP ingress, custom routes, or middleware should be instrumented.

## Repo Convention

In this repo:

- Shared Sentry option handling belongs in `src/lib/sentry.ts`.
- Import `src/sentry.ts` once from `src/app.ts` to register the Flue event bridge.
- Wrap the top-level Worker app in `src/app.ts` with `Sentry.withSentry(...)`.
- Wrap generated agent and workflow Durable Objects with module-local `extend({ wrap })` exports.
- Keep the issue-triage agent and workflow wrappers beside their owning modules.
- Use `CF_VERSION_METADATA.id` as the release fallback when `SENTRY_RELEASE` is unset.
- Clamp `SENTRY_TRACES_SAMPLE_RATE` from `0` to `1`; this repo defaults to `0.1`.
- Keep tests for disabled DSN behavior, release fallback, logs/RPC options, and sample-rate normalization.

Repo runtime values:

| Variable | Use |
| --- | --- |
| `SENTRY_DSN` | Enables reporting when non-empty. |
| `SENTRY_ENVIRONMENT` | Sets deployment environment. |
| `SENTRY_RELEASE` | Sets explicit release. |
| `SENTRY_TRACES_SAMPLE_RATE` | Controls trace sampling; clamp invalid values. |
| `CF_VERSION_METADATA` | Cloudflare release fallback. |

## Verify

- Run one failed workflow and one explicit `log.error(...)` against a non-production Sentry project.
- Confirm expected `flue.*` tags.
- Confirm the app starts with no DSN configured.
- On Cloudflare, exercise a wrapped agent or workflow under workerd or deployed Worker.
- Run the repo checks after observability changes:

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```
