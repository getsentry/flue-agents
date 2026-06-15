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

## Quick Start

Use Node.js 22.18 or newer, pnpm 11.1.1, Cloudflare auth, and a GitHub token.

```bash
pnpm install
cp .env.example .env
```

Set `GH_TOKEN` in `.env`, then run the deterministic checks:

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

`pnpm run build` does not require a GitHub token.

Then run the Cloudflare dev server:

```bash
pnpm run dev
```

The dev server listens on `http://localhost:3583`. Local dev requires Cloudflare auth and a `.env` containing `GH_TOKEN`.

Invoke the issue triage workflow:

```bash
curl "http://localhost:3583/workflows/issue-triage?wait=result" \
  -H "Content-Type: application/json" \
  -d '{"repository":"getsentry/sentry-mcp","issueNumber":1059}'
```

Use the workflow endpoint above for issue triage. The workflow owns the bounded read, duplicate search, diagnosis, and GitHub update sequence.

## Deploy

Set production secrets with Wrangler:

```bash
npx wrangler secret put GH_TOKEN
npx wrangler secret put FLUE_TRIAGE_MODEL # optional
npx wrangler secret put SENTRY_DSN # optional, enables Sentry reporting
```

```bash
pnpm run deploy
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for Cloudflare setup, environment variables, validation, and conventions for adding agents and workflows.
