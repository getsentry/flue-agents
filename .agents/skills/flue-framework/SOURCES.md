# Sources

## Source Inventory

| Source | Trust | Confidence | Contribution | Notes |
| --- | --- | --- | --- | --- |
| `https://flueframework.com/docs/getting-started/quickstart/` | Official docs | High | prerequisites, install, first agent, local connect | Last updated May 29, 2026. |
| `https://flueframework.com/docs/concepts/agents/` | Official docs | High | harness model, headless API, sandbox concept | Last updated May 29, 2026. |
| `https://flueframework.com/docs/introduction/why-flue/` | Official docs | Medium | feature map and design principles | Marked AI-generated awaiting review. |
| `https://flueframework.com/docs/guide/project-layout/` | Official docs | High | source-root discovery and discovered modules | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/models/` | Official docs | High | model specifiers, thinking levels, provider auth, Cloudflare provider paths | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/building-agents/` | Official docs | High | agent creation, ID/session semantics, route/websocket/dispatch | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/workflows/` | Official docs | High | workflow `run`, `init`, harness, structured results, run inspection | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/durable-execution/` | Official docs | High | persistence and recovery semantics | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/database/` | Official docs | Medium | db adapters, Cloudflare SQLite, stored vs unstored state | Marked AI-generated awaiting review. |
| `https://flueframework.com/docs/guide/skills/` | Official docs | High | imported skills, workspace-discovered skills, duplicate-name failure | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/tools/` | Official docs | High | custom tools, MCP servers, auth boundary | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/subagents/` | Official docs | High | subagent profiles and `session.task` | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/sandboxes/` | Official docs | High | virtual, local, remote sandboxes and persistence separation | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/routing/` | Official docs | High | Hono `app.ts`, route prefixes, exposed transports | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/develop-and-build/` | Official docs | High | `flue dev`, `flue build`, target and env behavior | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/chat/` | Official docs | High | chat surface mapping to agent ID/session | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/observability/` | Official docs | High | events, trace context, telemetry sanitization | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/targets/node/` | Official docs | High | Node target, `local`, `sqlite`, WebSocket transport | Last updated May 29, 2026. |
| `https://flueframework.com/docs/guide/targets/cloudflare/` | Official docs | Medium | generated Durable Objects, Wrangler, Workers AI, Sandbox, `extend`, `cloudflare.ts` | Marked AI-generated awaiting review. |
| `https://flueframework.com/docs/reference/configuration/` | Official docs | Medium | config fields and resolver behavior | Marked AI-generated awaiting review. |
| `https://flueframework.com/docs/api/agent-api/` | Official API docs | High | runtime APIs, config fields, operation options, fs/shell/session methods | Fetched full page. |
| `https://flueframework.com/docs/api/provider-api/` | Official API docs | High | provider registration/configuration signatures | Fetched full page. |
| `https://flueframework.com/docs/api/data-persistence-api/` | Official API docs | High | persistence adapter scope | Fetched full page. |
| `https://flueframework.com/docs/api/routing-api/` | Official API docs | High | public and admin route tables | Fetched full page. |
| `https://flueframework.com/docs/api/sandbox-api/` | Official API docs | High | custom sandbox connector contract | Fetched full page. |
| `https://flueframework.com/docs/api/events-reference/` | Official API docs | High | event categories and meanings | Fetched full page. |
| `https://flueframework.com/docs/api/errors-reference/` | Official API docs | High | public error categories and stability boundary | Fetched full page. |
| `https://flueframework.com/docs/cli/*` | Official CLI docs | High | command purposes, options, target support | Fetched overview, init, dev, run, connect, build, logs, add. |
| `https://flueframework.com/docs/sdk/*` | Official SDK docs | High | client options, agents/workflows/runs/admin/WebSocket/error/event APIs | Fetched overview and linked SDK refs. |
| `https://flueframework.com/docs/ecosystem/deploy/cloudflare/` | Official docs | Medium | Cloudflare deployment walkthrough, sandbox strategy, recovery semantics | Some sections repeat target docs; fetched full page. |
| `https://flueframework.com/docs/ecosystem/sandboxes/cloudflare/` | Official docs | High | Cloudflare Sandbox requirements and fit | Fetched full page. |
| `https://flueframework.com/docs/ecosystem/sandboxes/cloudflare-shell/` | Official docs | High | Cloudflare Shell requirements and limitations | Fetched full page. |
| `https://flueframework.com/docs/ecosystem/deploy/node/` and other ecosystem sandbox/deploy pages | Official docs | Medium | breadth check for non-Cloudflare variants and connector categories | Fetched linked pages for coverage. |
| `README.md` | Local repo | High | root layout, commands, Cloudflare/Sentry/GitHub conventions | Worktree was already modified; used as local convention source only. |
| `package.json` | Local repo | High | pnpm, scripts, dependency versions, Node requirement | Current repo state. |
| `wrangler.jsonc` | Local repo | High | current Worker config, AI binding, migrations, sandbox container | Current repo state. |
| `agents/issue-triage.ts`, `workflows/issue-triage.ts`, `cloudflare.ts` | Local repo | High | current Cloudflare Sandbox and Sentry extension patterns | Current repo state. |

## Synthesis Decisions

| Decision | Status | Evidence |
| --- | --- | --- |
| Classify as `integration-documentation` | Adopted | User requested synthesis of framework docs for implementation and deployment. |
| Use `reference-backed-expert` layout | Adopted | Flue docs span multiple optional areas; runtime should load only relevant branches. |
| Keep `SKILL.md` as router, not encyclopedia | Adopted | Skill-writer authoring and reference architecture rules. |
| Include repo root-layout guard | Adopted | `README.md`, user-provided AGENTS instructions, Flue project layout docs. |
| Split Cloudflare into its own reference | Adopted | User specifically requested deployment to Cloudflare and repo deploys to Cloudflare. |
| Include SDK/CLI in one reference | Adopted | Most code changes need only route/client/command lookup, not separate deep references. |
| Include troubleshooting reference | Adopted | Integration skills require failure/workaround coverage. |
| Omit full upstream code examples | Adopted | Runtime skill should summarize decisions and avoid becoming copied docs. |
| Do not add scripts | Rejected | No deterministic transformation or validation beyond existing skill validator is required. |

## Coverage Matrix

| Dimension | Status | Files |
| --- | --- | --- |
| Setup and installation | Covered | `references/project-setup.md` |
| Project layout and config | Covered | `references/project-setup.md` |
| API surface and behavior contracts | Covered | `references/agents-workflows.md`, `references/capabilities.md`, `references/routing-sdk-cli.md` |
| Config/runtime options | Covered | `references/project-setup.md`, `references/cloudflare-deploy.md` |
| Downstream use cases | Covered | agents, workflows, tools, skills, subagents, routing, SDK, Cloudflare deploy, sandboxing |
| Failure modes and workarounds | Covered | `references/troubleshooting.md` |
| Version and migration variance | Partial | Cloudflare SQLite beta boundary, Durable Object migrations, source layout, current repo versions |
| Cloudflare deployment | Covered | `references/cloudflare-deploy.md` |
| Local repo conventions | Covered | `SKILL.md`, all relevant references |

## Source Adaptation Notes

- Source intent: official docs teach Flue concepts, APIs, and deployment paths.
- Local target behavior: make coding agents produce repo-compatible Flue changes quickly and safely.
- Fidelity boundary: preserve behavior contracts, source-root discovery order, transport exposure rules, Cloudflare migration rules, and security boundaries.
- Local replacements: docs default to `src/`; this repo uses root layout, so references call out both upstream default and local rule.
- Omitted material: full prose, long code walkthroughs, non-Cloudflare deploy recipes beyond summary, and exhaustive SDK/WebSocket type tables.
- Rights and attribution: no long verbatim docs copied; source URLs retained here for attribution and refresh.

## Trigger Optimization

Should trigger:
- "Add a new Flue workflow and deploy it to Cloudflare."
- "Why is my Flue agent not discovered?"
- "Wire a Cloudflare Sandbox into this createAgent."
- "Expose this Flue workflow over HTTP."
- "Use @flue/runtime to add a tool and structured result."
- "Fix the wrangler migrations for a new Flue agent."

Should not trigger:
- "Write a generic Cloudflare Worker with no Flue."
- "Create an Agent Skill for a non-Flue repo."
- "Compare LLM providers generally."
- "Debug a Hono app that does not use Flue."
- "Explain Cloudflare pricing."

Final description was tuned to include Flue-specific nouns, Cloudflare deployment, and concrete APIs while excluding generic Cloudflare or AI SDK language.

## Gaps

| Gap | Impact | Next retrieval action |
| --- | --- | --- |
| Several official Flue pages are marked AI-generated awaiting review | Medium for exact edge behavior | Re-check upstream docs and changelog before high-risk production changes. |
| No Flue changelog deep synthesis beyond docs links | Medium for version drift | Fetch upstream changelog when package versions change. |
| Cloudflare platform docs not independently synthesized | Medium for Wrangler/container changes | Check official Cloudflare docs before migration, container, or Workers AI changes. |
| No real holdout run using this skill yet | Low | Use on the next Flue code change and record any misses. |

## Retrieval Stop Rationale

Collected all docs pages linked from the official docs navigation and fetched their Markdown forms, plus local repo convention files and current implementation examples. Further retrieval is likely to repeat known docs unless a task needs current Cloudflare or Flue changelog verification.
