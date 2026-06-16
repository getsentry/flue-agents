# Flue Framework Specification

## Intent

This skill helps agents build, modify, debug, and deploy Flue TypeScript applications using the official Flue docs plus this repository's `src/` layout, ecosystem channel, Sentry, and Cloudflare conventions.

It should reduce repeated docs crawling while preserving enough routing detail for an agent to open only the relevant reference before editing code.

## Scope

In scope:
- Flue project layout, configuration, CLI, models, and providers.
- Agents, workflows, sessions, structured results, dispatch, and direct transports.
- Tools, MCP servers, skills, subagents, and sandboxes.
- Routing, SDK clients, run inspection, persistence, observability, and error behavior.
- Ecosystem channel setup, especially GitHub webhook ingress and Octokit-backed tools.
- Sentry setup for Flue event reporting and Cloudflare Durable Object wrapping.
- Cloudflare Workers deployment, Durable Objects, Wrangler migrations, Workers AI, Cloudflare Sandbox, and module-local Cloudflare extensions.
- This repo's `src/` layout and pnpm conventions.

Out of scope:
- General TypeScript, Hono, Wrangler, Cloudflare, Sentry, or model-provider guidance beyond what Flue integration requires.
- Provider pricing or model recommendations that change frequently.
- Full upstream docs replacement.

## Users And Trigger Context

- Primary users: coding agents editing Flue apps.
- Common user requests: add a Flue agent, add a workflow, expose a route, add an ecosystem channel such as GitHub, add Sentry reporting, wire a skill, add a tool, configure a sandbox, deploy to Cloudflare, fix Flue build or runtime errors.
- Should not trigger for: unrelated Cloudflare Workers apps, non-Flue GitHub webhook services, generic Sentry setup outside Flue, non-Flue AI SDK work, generic prompt-writing, or editing ordinary Agent Skills outside Flue integration.

## Runtime Contract

- Required first actions: inspect source layout; preserve this repo's `src/` layout; route to focused references before editing.
- Required outputs: implementation, verification commands, and any deployment or migration notes needed by the change.
- Non-negotiable constraints: no committed secrets; no accidental `.flue/` or root-level Flue module addition in this repo; append migrations instead of rewriting deployed history.
- Expected bundled files loaded at runtime: `SKILL.md` plus one or more files in `references/` based on the requested task.

## Source And Evidence Model

Authoritative sources:
- Official Flue docs at `https://flueframework.com/docs/`, fetched as Markdown on June 15, 2026.
- Local repo instructions and files: `README.md`, `package.json`, `wrangler.jsonc`, `src/app.ts`, `src/lib/sentry.ts`, `src/sentry.ts`, `src/agents/`, `src/workflows/`, `src/cloudflare.ts`, and `src/skills/`.

Useful improvement sources:
- Positive examples: successful agent/workflow additions in this repo.
- Negative examples: Flue build failures, missed migrations, wrong source-root additions, incorrect channel payload assumptions, unsafe telemetry export, and deployment failures.
- Changelog or release notes: upstream Flue changelog for version-sensitive behavior.
- Validation results: `pnpm run typecheck`, `pnpm run build`, `pnpm run test`.

Data that must not be stored:
- secrets
- customer data
- private URLs or identifiers not needed for reproduction
- copied prompt, payload, or telemetry content that is not required to maintain the skill

## Reference Architecture

- `SKILL.md` contains: activation triggers, first actions, runtime routing, and verification defaults.
- `references/` contains: focused runtime lookup guides.
- `SOURCES.md` contains: source inventory, synthesis decisions, coverage matrix, and gaps.
- `scripts/` contains: none.
- `assets/` contains: none.

## Validation

- Lightweight validation: inspect frontmatter, verify every routed reference exists, and run the skill-writer quick validator when available.
- Deeper validation: use the skill during a real Flue code change and verify `pnpm run typecheck` plus `pnpm run build`.
- Holdout examples: adding a workflow with Cloudflare migration, adding an imported skill, adding a GitHub channel, adding Sentry reporting, fixing a route/auth exposure issue, and debugging a sandbox persistence misconception.
- Acceptance gates: no invalid references, no host-specific absolute runtime paths, no long copied docs, and source coverage gaps explicit in `SOURCES.md`.

## Known Limitations

- Several official Flue pages were marked "AI-generated, awaiting review"; treat those as lower confidence than reviewed pages.
- The skill is synthesized against docs fetched on June 15, 2026, refreshed for GitHub channel and Sentry docs on June 16, 2026, and package versions currently present in this repo.
- Cloudflare platform details can change; verify current Wrangler and Cloudflare docs before high-risk deployment changes.

## Maintenance Notes

- Update `SKILL.md` when trigger scope, routing, or first actions change.
- Update `SOURCES.md` when upstream docs are refreshed, local Flue versions change, or a source-backed decision changes.
- Update references when new Flue APIs, target behavior, or repo conventions appear.
- Add evidence files only for anonymized examples that directly improve future behavior.
