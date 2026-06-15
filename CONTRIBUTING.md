# Contributing

## Requirements

- Node.js 22.18 or newer
- pnpm 11.1.1
- Cloudflare account with Workers, Durable Objects with SQLite storage, Workers AI, and Containers / Cloudflare Sandbox enabled
- GitHub token for issue triage

## Setup

Install dependencies:

```bash
pnpm install
```

Authenticate Wrangler:

```bash
npx wrangler login
npx wrangler whoami
```

In non-interactive shells, set `CLOUDFLARE_API_TOKEN` instead of using browser login.

Create a local environment file:

```bash
cp .env.example .env
```

Set `GH_TOKEN` in `.env`. The issue triage workflow shells out to `gh`, so `GH_TOKEN` or `GITHUB_TOKEN` must be available to the Worker runtime.

Use `.env` for local Worker bindings. Avoid `.dev.vars` unless you intentionally want Wrangler's `.dev.vars` behavior, which takes precedence over `.env`.

## GitHub Token

For `issue-triage`, use a token with access to each target repository:

- Metadata: read
- Contents: read, for repository clone and inspection
- Issues: read and write, for issue context, labels, comments, edits, and closure

For organization-owned repositories, authorize the token for the organization and target repositories.

## Models

The default triage model is `cloudflare/@cf/moonshotai/kimi-k2.6`, using the Cloudflare AI binding configured in `wrangler.jsonc`.

Override it with `FLUE_TRIAGE_MODEL` in `.env` or as a Wrangler secret.

## Sentry

The Flue Cloudflare target generates Durable Object classes for agents and workflows. This repo wraps generated classes with module-local `cloudflare = extend({ wrap })` descriptors and shared options from `src/lib/sentry.ts`.

Configure these variables locally in `.env`:

```env
SENTRY_DSN=""
SENTRY_ENVIRONMENT="development"
SENTRY_RELEASE=""
SENTRY_TRACES_SAMPLE_RATE="0.1"
```

`SENTRY_DSN` enables reporting. `SENTRY_TRACES_SAMPLE_RATE` is clamped from `0` to `1` and defaults to `0.1`.

## Validation

Run deterministic checks before opening a PR:

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

`pnpm run build` does not require a GitHub token.

## Local Development

Run the Cloudflare dev server:

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

Use the workflow endpoint for issue triage. The workflow owns the bounded read, duplicate search, diagnosis, and deterministic GitHub update sequence.

## Deployment

Confirm the Worker name, Durable Object migrations, AI binding, and Sandbox container image in `wrangler.jsonc`.

Set production secrets:

```bash
npx wrangler secret put GH_TOKEN
npx wrangler secret put FLUE_TRIAGE_MODEL # optional
npx wrangler secret put SENTRY_DSN # optional
```

Set `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, and `SENTRY_TRACES_SAMPLE_RATE` as Wrangler variables or secrets when production needs different Sentry metadata.

Deploy:

```bash
pnpm run deploy
```

`pnpm run deploy` runs the Flue Cloudflare build and then `wrangler deploy`.

## Adding Agents and Workflows

Place Flue modules under `src/`. Keep discovered agent and workflow files flat and lower-kebab-case.

Create an agent module:

```text
src/agents/<agent-name>.ts
```

Start with this shape:

```ts
import { createAgent, type AgentRouteHandler } from "@flue/runtime";

export const route: AgentRouteHandler = async (_c, next) => next();

export default createAgent(() => ({
  model: "cloudflare/@cf/moonshotai/kimi-k2.6",
  instructions: "Describe what this agent should do.",
}));
```

Export `route` only when the agent should accept direct HTTP prompts. Workflow-owned agents use the workflow entry point.

If the agent needs a reusable skill, add:

```text
src/skills/<skill-name>/SKILL.md
```

Then import it from the agent:

```ts
import mySkill from "../skills/<skill-name>/SKILL.md" with { type: "skill" };
```

If the agent needs a full Linux environment, use the existing Cloudflare Sandbox binding and container pattern from `src/agents/issue-triage.ts`.

For one-shot jobs that return a result, add a workflow:

```text
src/workflows/<workflow-name>.ts
```

The workflow imports the agent, calls `init(agent)`, opens a session, and returns the result.

Append Durable Object migrations in `wrangler.jsonc` for new discovered entries:

- `src/agents/foo-bar.ts` -> `FlueFooBarAgent`
- `src/workflows/foo-bar.ts` -> `FlueFooBarWorkflow`

Keep migration history ordered. Do not rewrite migrations that have already been deployed.

For Sentry reporting, export a module-local `cloudflare = extend({ wrap })` descriptor as shown in `src/agents/issue-triage.ts` or `src/workflows/issue-triage.ts`.
