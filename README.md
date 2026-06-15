# Sentry Flue Agents

Flue agents for Sentry automation, deployed on Cloudflare Workers.

This repo uses Flue's recommended `src/` source layout:

```text
src/
├─ agents/       Addressable agents
├─ workflows/    Finite operations around agents
├─ skills/       Packaged Agent Skills imported by agents
├─ lib/          Shared implementation helpers
└─ cloudflare.ts Cloudflare-only Worker exports
fixtures/        Captured examples and regression inputs
```

Do not add `.flue/` or root-level Flue source directories. Flue discovers only one source directory, in this order: `.flue/`, `src/`, then the project root. This repo intentionally uses `src/`.

## First Agent

`src/agents/issue-triage.ts` is the first Sentry Flue agent. It imports the migrated `src/skills/issue-triage` skill and runs in a Cloudflare Sandbox container so it can use `gh`, `git`, and `pnpm` while inspecting GitHub issues and repositories.

The bounded issue-triage job is exposed as `src/workflows/issue-triage.ts`.

## Setup

Use Node.js 22.18 or newer. This matches Flue's current quickstart requirement and the `engines.node` field in `package.json`.

```bash
pnpm install
```

### Cloudflare

Authenticate Wrangler and confirm it can see your account:

```bash
npx wrangler login
npx wrangler whoami
```

In non-interactive shells, set `CLOUDFLARE_API_TOKEN` instead of using browser login.

This project uses Cloudflare Workers, Durable Object SQLite, Workers AI, and Cloudflare Sandbox containers. Local dev and deployment therefore need a Cloudflare account with these capabilities enabled:

- Workers
- Durable Objects with SQLite storage
- Workers AI
- Containers / Cloudflare Sandbox

### Environment

Use `.env` for local development:

```bash
cp .env.example .env
```

Then set `GH_TOKEN` in `.env`. Set `SENTRY_DSN` only when you want local errors and traces to report to Sentry; an empty DSN disables the SDK for local development.

Cloudflare's current local development tooling supports `.env`. Do not also create `.dev.vars` unless you intentionally want Wrangler's `.dev.vars` behavior; when `.dev.vars` exists, `.env` values are not loaded into local Worker bindings.

The default model is `cloudflare/@cf/moonshotai/kimi-k2.6`, using the Cloudflare AI binding configured in `wrangler.jsonc`. Override it by adding `FLUE_TRIAGE_MODEL` to `.env` or as a Wrangler secret.

### Sentry

The Flue Cloudflare target generates Durable Object classes for agents and workflows. This repo uses Flue's module-level `cloudflare = extend({ wrap })` hook to wrap the generated `issue-triage` agent and workflow classes with `Sentry.instrumentDurableObjectWithSentry(...)`.

Configure these variables locally in `.env`:

```env
SENTRY_DSN=""
SENTRY_ENVIRONMENT="development"
SENTRY_RELEASE=""
SENTRY_TRACES_SAMPLE_RATE="0.1"
```

`SENTRY_DSN` is the only required value for reporting. `SENTRY_TRACES_SAMPLE_RATE` is clamped from `0` to `1`, defaults to `0.1`, and controls performance trace sampling.

### GitHub

The issue triage workflow shells out to `gh`, so `GH_TOKEN` or `GITHUB_TOKEN` must be available to the Worker runtime.

For the current `issue-triage` workflow, use a GitHub token with access to the target repositories:

- Metadata: read
- Contents: read, for repository clone and inspection
- Issues: read and write, for issue context, labels, comments, edits, and closure

For organization-owned repositories, make sure the token is authorized for the organization and for every repository the agent should triage.

## Test Locally

Run the deterministic checks first:

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

`pnpm run build` should discover `1 agent(s): issue-triage` and `1 workflow(s): issue-triage`. It does not require a GitHub token.

Then run the Cloudflare dev server:

```bash
pnpm run dev
```

The dev server listens on `http://localhost:3583`. Because this project uses Cloudflare Sandbox containers, local dev uses Wrangler's Cloudflare target path and requires valid Cloudflare auth plus a local `.env` containing `GH_TOKEN`.

Invoke the migrated triage workflow:

```bash
curl "http://localhost:3583/workflows/issue-triage?wait=result" \
  -H "Content-Type: application/json" \
  -d '{"repository":"getsentry/sentry-mcp","issueNumber":1059}'
```

Use the workflow endpoint above for issue triage. The `issue-triage` agent is invoked by the workflow so callers cannot bypass the bounded read, duplicate search, diagnosis, and deterministic GitHub update sequence.

## Deploy

Before deploying, confirm the Worker name, Durable Object migrations, AI binding, and Sandbox container image in `wrangler.jsonc`.

Set production secrets with Wrangler:

```bash
npx wrangler secret put GH_TOKEN
npx wrangler secret put FLUE_TRIAGE_MODEL # optional
npx wrangler secret put SENTRY_DSN # optional, enables Sentry reporting
```

Set `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, and `SENTRY_TRACES_SAMPLE_RATE` as Wrangler variables or secrets if you need production-specific Sentry metadata.

Run validation, then deploy:

```bash
pnpm run test
pnpm run typecheck
pnpm run build
pnpm run deploy
```

`pnpm run deploy` runs the Flue Cloudflare build and then `wrangler deploy`.

## Validation

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

Current validation status:

- `pnpm install` completes after pnpm build-script approvals are recorded in `pnpm-workspace.yaml`.
- `pnpm run test` passes the Sentry option contract tests.
- `pnpm run typecheck` passes.
- `pnpm run build` passes and discovers `1 agent(s): issue-triage` and `1 workflow(s): issue-triage`.
- `pnpm run build` currently emits non-fatal Wrangler log-file noise if the process cannot write under `~/Library/Preferences/.wrangler/logs`; the build still exits successfully and writes `dist/`.
- Sentry instrumentation typechecks and builds; it is disabled at runtime until `SENTRY_DSN` is configured.
- `pnpm run dev` requires valid Cloudflare auth and a local `.env` with `GH_TOKEN` before the workflow can be exercised end to end.
- In this sandbox, live dev testing was not completed because the Flue dev supervisor first hit `EMFILE: too many open files, watch`, and the direct internal dev path then reached Wrangler but failed on expired Cloudflare auth in a non-interactive shell.

`pnpm run build` does not require a GitHub token, but `pnpm run dev` and workflow invocations need Cloudflare auth. The workflow itself also requires `GH_TOKEN` or `GITHUB_TOKEN`.

## Creating Agents

Use Flue's `src/` source layout. Do not add `.flue/` or root-level Flue source directories.

1. Create an agent module:

   ```text
   src/agents/<agent-name>.ts
   ```

   Use lower-kebab-case filenames. The filename becomes the Flue agent name.

2. Start with this shape:

   ```ts
   import { createAgent, type AgentRouteHandler } from "@flue/runtime";

   export const route: AgentRouteHandler = async (_c, next) => next();

   export default createAgent(() => ({
     model: "cloudflare/@cf/moonshotai/kimi-k2.6",
     instructions: "Describe what this agent should do.",
   }));
   ```

   Export `route` only when the agent should accept direct HTTP prompts. For workflow-owned agents like `issue-triage`, omit the route so callers use the bounded workflow entry point.

3. If the agent needs a reusable skill, add:

   ```text
   src/skills/<skill-name>/SKILL.md
   ```

   Then import it from the agent with:

   ```ts
   import mySkill from "../skills/<skill-name>/SKILL.md" with { type: "skill" };
   ```

4. If the agent needs a full Linux environment, use the existing Cloudflare Sandbox binding and container pattern from `src/agents/issue-triage.ts`.

5. If the work is a one-shot job that returns a result, add a workflow:

   ```text
   src/workflows/<workflow-name>.ts
   ```

   The workflow should import the agent, call `init(agent)`, open a session, and return the result.

6. Append Cloudflare Durable Object migrations in `wrangler.jsonc` for new discovered entries:

   - `src/agents/foo-bar.ts` -> `FlueFooBarAgent`
   - `src/workflows/foo-bar.ts` -> `FlueFooBarWorkflow`

   Keep migration history ordered. Do not rewrite migrations that have already been deployed.

7. Run:

   ```bash
   pnpm run typecheck
   pnpm run build
   ```

   Check the build output for the discovered agent/workflow count and generated class names before deploying.

8. If the new agent or workflow should report to Sentry, export a module-local `cloudflare = extend({ wrap })` descriptor as shown in `src/agents/issue-triage.ts` or `src/workflows/issue-triage.ts`.
