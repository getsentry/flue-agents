# Sentry Flue Agents

Flue agents for Sentry automation, deployed on Cloudflare Workers.

## Layout

Flue modules live under `src/`.

```text
src/
├─ agents/       Addressable agents
├─ workflows/    Finite operations around agents
├─ skills/       Packaged Agent Skills imported by agents
├─ lib/          Shared implementation helpers
└─ cloudflare.ts Cloudflare-only Worker exports
fixtures/        Captured examples and regression inputs
```

## Issue Triage

`src/agents/issue-triage.ts` imports the `src/skills/issue-triage` skill and runs in a Cloudflare Sandbox container so it can use `gh`, `git`, and `pnpm` while inspecting GitHub issues and repositories.

The bounded issue-triage job is exposed as `src/workflows/issue-triage.ts`.

Issue-triage eval fixtures live in `fixtures/issue-triage/`. Vitest starts one
local Flue Node server for the suite, invokes a fresh workflow instance for each
fixture through `@flue/sdk`, and checks stable decision fields through
`vitest-evals`.

```bash
pnpm evals
```

`pnpm evals` defaults to `openrouter/anthropic/claude-sonnet-4.6`, matching the
provider and model used by the production Cloudflare Worker. Set
`OPENROUTER_API_KEY` in `.env.local` or your shell. The runner loads `.env`
first, then `.env.local`, with shell variables winning over both. Evals only
accept `openrouter/...` models. Model calls have a hard 120-second timeout. The
eval server receives no GitHub credentials and never calls GitHub; issue and
repository context comes entirely from the fixture. Each fixture runs with the
production issue-triage agent configuration and applies deterministic assertions
to the same normalized GitHub-visible outcome used by production. Fixtures may
also define a qualitative rubric scored by a separate `vitest-evals` judge on
usefulness, precision, structure, and restraint. Both the internal diagnosis and
the final outcome remain inspectable in `vitest-results.json`.

## Quick Start

Use Node.js 22.19 or newer, pnpm 11.1.1, Cloudflare auth, and a GitHub App installed on the repositories you want to triage.

```bash
pnpm install
cp .env.example .env.local
```

Create a GitHub App owned by the organization or bot account that should appear as the triage actor.

Configure the app:

- Metadata: read
- Contents: read
- Issues: read and write
- Webhook URL: `https://sentry-flue-agents.getsentry.workers.dev/channels/github/webhook`
- Webhook content type: `application/json`
- Webhook secret: generate one with `openssl rand -hex 32`
- Webhook events: subscribe to **Issues** only

Install the app with **Only select repositories** and choose the repositories this service should triage. Generate a private key, then copy these values into `.env.local`:

```env
# GitHub App General tab: use Client ID, not App ID.
GITHUB_APP_CLIENT_ID="Iv1..."

# GitHub App installation URL: /settings/installations/<this-number>
GITHUB_APP_INSTALLATION_ID="12345678"

# Downloaded GitHub App private key. Keep \n escapes if pasted on one line.
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Same value as the GitHub App webhook secret.
GITHUB_WEBHOOK_SECRET="..."

# Internal token for manual/operator workflow calls.
FLUE_HTTP_TOKEN="..."
```

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

`pnpm run build` does not require GitHub App credentials.

Then run the Cloudflare dev server:

```bash
pnpm run dev
```

The dev server listens on `http://localhost:3583`. Local dev requires Cloudflare auth and a `.env.local` containing the GitHub App credentials. The `dev` script loads `.env.local` explicitly and disables Wrangler's automatic `.env` loading; `build` and `deploy` ignore dot-env files and use Wrangler production secrets.

Invoke the issue triage workflow manually:

```bash
set -a
source .env.local
set +a

curl "http://localhost:3583/workflows/issue-triage?wait=result" \
  -H "Authorization: Bearer $FLUE_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repository":"getsentry/sentry-mcp","issueNumber":1059,"dryRun":true}'
```

Use `dryRun: true` to run duplicate search, repository inspection, and structured diagnosis without labels, comments, edits, or closure. The result includes proposed actions plus `bug_analysis` or `gap_analysis`, which makes behavior review safe before enabling mutations. Omit `dryRun` for the normal mutating workflow.

The production GitHub App webhook uses `/channels/github/webhook` through Flue's GitHub channel package and starts workflow runs after signature verification. It currently admits `issues.opened` events only. The workflow endpoint is protected and should be used only for authorized manual/operator runs.

## Deploy

Merges to `main` deploy automatically through Cloudflare Workers Builds. See [DEPLOYMENT.md](DEPLOYMENT.md) for the Cloudflare dashboard settings and runtime secret setup.

See [OBSERVABILITY.md](OBSERVABILITY.md) for Sentry and Cloudflare logging setup.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and conventions for adding agents and workflows.
