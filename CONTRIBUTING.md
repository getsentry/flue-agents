# Contributing

## Requirements

- Node.js 22.19 or newer
- pnpm 11.1.1
- Cloudflare account with Workers, Durable Objects with SQLite storage, and Containers / Cloudflare Sandbox enabled
- GitHub App installed on the repositories issue triage should manage

## Setup

Install dependencies:

```bash
pnpm install
```

Authenticate Wrangler:

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

In non-interactive shells, set `CLOUDFLARE_API_TOKEN` instead of using browser login.

Create a local environment file:

```bash
cp .env.example .env.local
```

Set the GitHub App credentials in `.env.local`. The issue triage workflow mints a short-lived installation token and passes it to `gh` inside the Cloudflare Sandbox.

Use `.env.local` for local Worker bindings. Avoid `.env` and `.dev.vars`; the project scripts disable Wrangler's automatic dot-env loading so local overrides stay explicit, and production uses Wrangler secrets.

## GitHub App

Create a GitHub App owned by the organization or bot account that should appear as the triage actor. Install it only on the selected repositories issue triage should manage.

For `issue-triage`, grant these repository permissions:

- Metadata: read
- Contents: read, for repository clone and inspection
- Issues: read and write, for issue context, labels, comments, edits, and closure

Configure the GitHub App webhook:

- Webhook URL: `https://sentry-flue-agents.getsentry.workers.dev/channels/github/webhook`
- Content type: `application/json`
- Secret: a generated secret also stored in `GITHUB_WEBHOOK_SECRET`
- Events: Issues

The Worker admits only supported issue events. The current automatic event is `issues.opened`; direct workflow invocation is reserved for authorized manual/operator use.

Generate a private key for the app and copy the installed app's installation ID. Configure local development with:

```env
GITHUB_APP_CLIENT_ID="Iv1..."
GITHUB_APP_INSTALLATION_ID="12345678"
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET="..."
FLUE_HTTP_TOKEN="..."
```

`GITHUB_APP_CLIENT_ID` is the JWT issuer. The private key may be pasted as a single quoted value with `\n` escapes.

Reference:

- GitHub App JWTs: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
- Installation access tokens: https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app

## Models

The default triage model is `openrouter/anthropic/claude-sonnet-4.6` in both
production and evals. Production requires `OPENROUTER_API_KEY` as a Wrangler
secret.

Override it with `FLUE_TRIAGE_MODEL` in `.env.local` or as a Wrangler secret.

Issue-triage evals run locally with Flue's Node target. `pnpm evals` defaults to
the same OpenRouter provider and Sonnet 4.6 model as production.

Configure evals in `.env.local`; the runner loads `.env` first, then
`.env.local`, with shell variables winning over both:

```env
FLUE_TRIAGE_EVAL_MODEL="openrouter/anthropic/claude-sonnet-4.6"
FLUE_TRIAGE_JUDGE_MODEL="openrouter/anthropic/claude-haiku-4.5"
OPENROUTER_API_KEY=""
```

Use only `openrouter/...` values for `FLUE_TRIAGE_EVAL_MODEL`; the eval runner
rejects other providers.

The eval suite starts one local Flue Node server, then invokes a fresh workflow
instance per fixture through `@flue/sdk`. The fixture-backed workflow uses the
production agent configuration, returns its internal `diagnosis`, and resolves
the same GitHub-visible `outcome` as production. Every case uses the configured
LLM and runs through `vitest-evals`. Model calls have a hard 120-second timeout;
rubric-judged cases may use up to 150 seconds total while the second model scores
the result.

Evals never call GitHub. The server is started without GitHub credentials, and
all issue context is fixture-backed. Add a JSON file under
`fixtures/issue-triage/` using this minimal shape; the filename becomes the case
identifier, `name` is the human-readable case name, unknown fields fail
validation, and all expectation fields are optional:

```json
{
  "name": "asks for the blocking error detail",
  "description": "What behavior this case protects.",
  "source": {
    "repository": "getsentry/example",
    "issueNumber": 123,
    "capturedAt": "2026-07-17T00:00:00Z"
  },
  "repositoryLabels": ["bug"],
  "issue": {
    "author": "reporter",
    "authorAssociation": "NONE",
    "title": "Issue title",
    "labels": [],
    "body": "Issue body"
  },
  "rubric": {
    "pass": ["Explains the reported failure without inventing evidence."],
    "fail": ["Claims the issue was reproduced when it was not."],
    "threshold": 0.8
  },
  "expectedOutcome": {
    "action": "comment",
    "labels_include": ["bug"],
    "comment_includes": ["exact error"],
    "comment_excludes": ["maintainer can take it"],
    "max_comment_words": 80,
    "needs_human_review": false
  }
}
```

`repositoryLabels` are the labels available for the agent to apply. `labels`
are labels already present on the issue. Keep both input fields independent from
the assertions under `expectedOutcome`. `diagnosis` means the agent's internal
evidence and reasoning. `outcome` means the exact normalized GitHub action,
labels, comment, closure, and review state. Labels are orthogonal to the primary
action. `expectedOutcome` contains the deterministic assertions; omitted fields
are not scored.

Use `action: "none"`, `"label"`, `"comment"`, or `"close"` for
the primary GitHub-visible result. Add `duplicateCandidates` only for a
duplicate-search case; each candidate contains its issue number, title, URL,
state, confidence, and search reason.

The deterministic `expectedOutcome` checks always run. Add the optional
`rubric` when usefulness also needs qualitative judgment. The judge scores the
final `outcome` on usefulness, precision, structure, and restraint, and uses the
lowest dimension as the case score. `pass` and `fail` hold case-specific
criteria; `threshold` defaults to `0.75`. The judge defaults to Claude Haiku 4.5
and can be changed with `FLUE_TRIAGE_JUDGE_MODEL`.

## Sentry

See [OBSERVABILITY.md](OBSERVABILITY.md) for the Flue Sentry bridge, Cloudflare Worker wrapping, runtime variables, and verification steps.

Configure these variables locally in `.env.local`:

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
pnpm evals
```

`pnpm run build` does not require GitHub App credentials.
`pnpm evals` requires the eval model provider key described in [Models](#models).

## Local Development

Run the Cloudflare dev server:

```bash
pnpm run dev
```

The dev server listens on `http://localhost:3583`. Local dev requires Cloudflare auth and a `.env.local` containing the GitHub App credentials. The `dev` script loads `.env.local` explicitly and disables Wrangler's automatic `.env` loading; `build` and `deploy` ignore dot-env files and use Wrangler production secrets.

Invoke the issue triage workflow:

```bash
set -a
source .env.local
set +a

curl "http://localhost:3583/workflows/issue-triage?wait=result" \
  -H "Authorization: Bearer $FLUE_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repository":"getsentry/sentry-mcp","issueNumber":1059}'
```

Use the workflow endpoint for authorized manual issue triage. Production automatic triage enters through the signed GitHub webhook route at `/channels/github/webhook`.

## Deployment

Production deploys are automated by Cloudflare Workers Builds on pushes to `main`. See [DEPLOYMENT.md](DEPLOYMENT.md) for the Cloudflare dashboard settings, runtime secrets, and manual recovery deploy command.

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
  model: "openrouter/anthropic/claude-sonnet-4.6",
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
