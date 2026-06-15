---
name: flue-framework
description: Use when building, modifying, debugging, or deploying Flue TypeScript agents and workflows, especially Flue project layout, createAgent, workflows, tools, skills, subagents, sandboxes, routing, SDK clients, persistence, observability, or Cloudflare Workers deployment.
---

# Flue Framework

Use this skill for Flue framework work in this repository or in any TypeScript project using `@flue/runtime` or `@flue/cli`.

## First Actions

1. Inspect the project layout before editing. Flue discovers only the first source directory that exists: `.flue/`, then `src/`, then the project root.
2. In this repo, preserve the root layout: root `agents/`, `workflows/`, `skills/`, `app.ts`, and `cloudflare.ts`. Do not add `.flue/` or `src/` unless the whole repo is being migrated.
3. Use `pnpm` commands when installing, building, or testing.
4. Keep secrets in `.env` locally or platform secrets in production. Never place secrets in imported skills, agent modules, config, fixtures, or docs.

## Route By Need

| Need | Read |
| --- | --- |
| Project setup, source discovery, configuration, models, providers, and local commands | `references/project-setup.md` |
| Addressable agents, finite workflows, sessions, structured results, dispatch, and direct transport exports | `references/agents-workflows.md` |
| Tools, MCP servers, skills, subagents, sandbox selection, filesystem, and shell behavior | `references/capabilities.md` |
| HTTP routing, Hono `app.ts`, public route exposure, SDK clients, WebSockets, and CLI surfaces | `references/routing-sdk-cli.md` |
| Session persistence, workflow runs, durable execution, events, logs, telemetry, and error handling | `references/persistence-observability.md` |
| Cloudflare Workers target, Durable Objects, `wrangler.jsonc`, Workers AI, Sandbox, `cloudflare.ts`, and deployment | `references/cloudflare-deploy.md` |
| Build failures, runtime failures, security mistakes, migration issues, or ambiguous Flue behavior | `references/troubleshooting.md` |

## Runtime Defaults

- Use `createAgent(...)` for continuing agent instances and `run({ init, payload, env })` for finite workflows.
- Export `route` or `websocket` only when the module should expose that public transport.
- Prefer workflows for bounded jobs that need deterministic setup, validation, side effects, or structured return data.
- Prefer tools for executable application capabilities, skills for reusable instructions, subagents for delegated specialist reasoning, and sandboxes for filesystem or command execution.
- Use Valibot result schemas when application code depends on fields rather than prose.
- For Cloudflare in this repo, default model paths should use the configured Workers AI binding, e.g. `cloudflare/...`, unless the task explicitly changes providers.

## Verify

After Flue code changes in this repo, run the smallest relevant checks:

```bash
pnpm run typecheck
pnpm run build
```

Run `pnpm run test` when behavior, validation, persistence, or workflow logic changes.
