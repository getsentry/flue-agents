# Deployment

Production deploys are owned by Cloudflare Workers Builds, not GitHub Actions and not `wrangler.jsonc`.

## Cloudflare Builds

Configure this in Cloudflare Dashboard:

```text
Account: Sentry Enterprise
Worker: sentry-flue-agents
Settings: Builds
Git repository: getsentry/flue-agents
Git branch: main
Root directory: /
Build command: pnpm run build:cloudflare
Deploy command: pnpm run deploy:cloudflare
```

Set these build variables in **Settings > Builds > Build variables and secrets**:

```text
NODE_VERSION=22.19.0
PNPM_VERSION=11.1.1
```

Workers Builds installs dependencies before the build command. Do not add these build trigger settings to `wrangler.jsonc`; Cloudflare Workers Builds does not honor Wrangler custom build configuration for this.

Before the first deploy, create the Cloudflare Workers Observability Logs destination named `sentry-logs` described in [OBSERVABILITY.md](OBSERVABILITY.md). `wrangler.jsonc` references that destination for runtime log export to Sentry.

## Runtime Secrets

Runtime secrets live on the Worker, not in Cloudflare Builds variables. Set them with Wrangler or in Cloudflare Dashboard under **Settings > Variables and Secrets**:

```bash
pnpm exec wrangler secret put GITHUB_APP_CLIENT_ID
pnpm exec wrangler secret put GITHUB_APP_INSTALLATION_ID
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY
pnpm exec wrangler secret put GITHUB_WEBHOOK_SECRET
pnpm exec wrangler secret put FLUE_HTTP_TOKEN
pnpm exec wrangler secret put FLUE_TRIAGE_MODEL # optional
pnpm exec wrangler secret put SENTRY_DSN
pnpm exec wrangler secret put SENTRY_ENVIRONMENT # optional
pnpm exec wrangler secret put SENTRY_RELEASE # optional
pnpm exec wrangler secret put SENTRY_TRACES_SAMPLE_RATE # optional
```

`GITHUB_WEBHOOK_SECRET` must exactly match the GitHub App webhook secret. `FLUE_HTTP_TOKEN` is separate and protects manual/operator calls to Flue routes.

See [OBSERVABILITY.md](OBSERVABILITY.md) for Sentry and Cloudflare log verification.

## Manual Recovery

Manual deploys should be reserved for recovery or testing:

```bash
pnpm run deploy
```

Normal production deploys happen from Cloudflare Builds when `main` changes.
