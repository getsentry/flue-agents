# Observability

Production observability is split between Flue activity reporting, Sentry application telemetry, and Cloudflare Workers platform log export.

## Sentry

This setup follows the Flue Sentry guide: https://flueframework.com/docs/ecosystem/tooling/sentry/

The Worker uses `@sentry/cloudflare` with shared options in `src/lib/sentry.ts`. `src/sentry.ts` registers Flue's `observe(...)` bridge once from `src/app.ts`.

Sentry wraps:

- The top-level HTTP app in `src/app.ts`, including GitHub webhook ingress and protected manual Flue routes.
- The generated issue-triage agent Durable Object through `src/agents/issue-triage.ts`.
- The generated issue-triage workflow Durable Object through `src/workflows/issue-triage.ts`.

The Flue observer reports:

- workflow `run_end` events where `isError` is true;
- `ctx.log.error(...)` as an exception when the log has an `error` attribute;
- other `ctx.log.error(...)` calls as error-level Sentry messages.

Captures include `flue.*` correlation tags such as run id, instance id, dispatch id, event index, workflow name, operation id, and session names when Flue provides them. The observer does not forward arbitrary log attributes, prompts, responses, tool arguments, tool results, or complete event payloads.

Set the runtime DSN as a Worker secret:

```bash
pnpm exec wrangler secret put SENTRY_DSN
```

Optional runtime variables:

```text
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<explicit-release>
SENTRY_TRACES_SAMPLE_RATE=0.1
```

`SENTRY_DSN` enables Sentry. `SENTRY_TRACES_SAMPLE_RATE` defaults to `0.1` and is clamped between `0` and `1`. `enableLogs` is enabled when a DSN is present so application code can use Sentry SDK structured logs, but this is not the Cloudflare platform log drain.

## Cloudflare Platform Logs

Cloudflare Workers Builds logs are deployment logs. They are configured in Cloudflare Dashboard under the Worker **Settings > Builds** area and are not controlled by `wrangler.jsonc`.

Runtime platform log export is configured with Cloudflare Workers Observability destinations, not with the Sentry SDK. `wrangler.jsonc` enables Workers log export to a destination named `sentry-pierre-logs`:

```jsonc
"observability": {
  "logs": {
    "enabled": true,
    "destinations": ["sentry-pierre-logs"]
  }
}
```

Create that destination in Cloudflare before deploying:

1. In Sentry, open the project **Settings > Client Keys (DSN)** page.
2. Copy the OTLP logs endpoint. It has this shape:

   ```text
   https://{HOST}/api/{PROJECT_ID}/integration/otlp/v1/logs
   ```

3. In Cloudflare Dashboard, open **Workers & Pages > Observability > Pipelines**.
4. Add a destination:

   ```text
   Destination Name: sentry-pierre-logs
   Destination Type: Logs
   OTLP Endpoint: <Sentry OTLP logs endpoint>
   Custom Header Name: x-sentry-auth
   Custom Header Value: sentry sentry_key=<SENTRY_PUBLIC_KEY>
   ```

The destination name must match `wrangler.jsonc`. The Sentry public key is the public key from the project DSN/client key; keep the endpoint and header in Cloudflare dashboard configuration rather than repository source.

Runtime platform logs can be inspected with:

```bash
pnpm exec wrangler tail sentry-flue-agents
```

Use a Tail Worker only if the OTEL export is not enough and custom filtering or transformation is required before forwarding logs. Cloudflare Logpush HTTP destinations are another account/zone-level option for supported datasets, but Workers Observability OTEL export is the direct Cloudflare-to-Sentry setup for Worker application logs.

## Verification

After changing observability code or config, run:

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

After deploy, verify:

- The Worker has a non-empty `SENTRY_DSN` runtime secret.
- Cloudflare has a Workers Observability Logs destination named `sentry-pierre-logs`.
- Sentry receives events in the expected project and environment.
- One explicit Flue `ctx.log.error(...)` call appears in Sentry with the expected `flue.*` correlation tags.
- Worker logs are visible with `pnpm exec wrangler tail sentry-flue-agents`.
- Worker `console.log(...)` output appears in Sentry Logs after deploy. Cloudflare notes that OTEL exports can take a few minutes to arrive.
