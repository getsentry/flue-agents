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
| `https://flueframework.com/docs/ecosystem/channels/github/` | Official docs | Medium | `@flue/github`, webhook path, native delivery contract, Octokit tool boundary, delivery timing and dedupe guidance | Marked AI-generated awaiting review; Markdown fetched June 16, 2026. |
| `https://flueframework.com/docs/ecosystem/channels/slack/` | Official docs | High | second channel example for native provider payloads, verified ingress, tool binding, acknowledgements, and dedupe | Last updated Jun 13, 2026; used as synthesis evidence, not a runtime reference. |
| `https://flueframework.com/docs/ecosystem/tooling/sentry/` | Official docs | Medium | Sentry blueprint, Node vs Cloudflare target behavior, event bridge defaults, data export boundaries, verification | Marked AI-generated awaiting review; Markdown fetched June 16, 2026. |
| `https://flueframework.com/docs/ecosystem/tooling/opentelemetry/` | Official docs | Medium | comparison point for vendor-neutral trace export and content export policy | Marked AI-generated awaiting review; used as synthesis evidence. |
| `https://flueframework.com/docs/ecosystem/tooling/braintrust/` | Official docs | Medium | comparison point for content-bearing model traces and Cloudflare delivery caveat | Marked AI-generated awaiting review; used as synthesis evidence. |
| `https://flueframework.com/docs/ecosystem/deploy/cloudflare/` | Official docs | Medium | Cloudflare deployment walkthrough, sandbox strategy, recovery semantics | Some sections repeat target docs; fetched full page. |
| `https://flueframework.com/docs/ecosystem/sandboxes/cloudflare/` | Official docs | High | Cloudflare Sandbox requirements and fit | Fetched full page. |
| `https://flueframework.com/docs/ecosystem/sandboxes/cloudflare-shell/` | Official docs | High | Cloudflare Shell requirements and limitations | Fetched full page. |
| `https://flueframework.com/docs/ecosystem/deploy/node/` and other ecosystem sandbox/deploy pages | Official docs | Medium | breadth check for non-Cloudflare variants and connector categories | Fetched linked pages for coverage. |
| `AGENTS.md` and `README.md` | Local repo | High | `src/` layout, commands, Cloudflare/Sentry/GitHub conventions | Worktree was already modified; used as local convention source only. |
| `package.json` | Local repo | High | pnpm, scripts, dependency versions, Node requirement | Current repo state. |
| `wrangler.jsonc` | Local repo | High | current Worker config, AI binding, migrations, sandbox container | Current repo state. |
| `src/agents/issue-triage.ts`, `src/workflows/issue-triage.ts`, `src/app.ts`, `src/sentry.ts`, `src/lib/sentry.ts`, `tests/sentry.test.ts`, `src/cloudflare.ts` | Local repo | High | current Cloudflare Sandbox, custom GitHub ingress, Sentry event bridge/options/tests, and Sentry extension patterns | Current repo state; some files were already modified in the worktree. |

## Synthesis Decisions

| Decision | Status | Evidence |
| --- | --- | --- |
| Classify as `integration-documentation` | Adopted | User requested synthesis of framework docs for implementation and deployment. |
| Use `reference-backed-expert` layout | Adopted | Flue docs span multiple optional areas; runtime should load only relevant branches. |
| Keep `SKILL.md` as router, not encyclopedia | Adopted | Skill-writer authoring and reference architecture rules. |
| Include repo `src/` layout guard | Adopted | `AGENTS.md`, `README.md`, Flue project layout docs. |
| Split Cloudflare into its own reference | Adopted | User specifically requested deployment to Cloudflare and repo deploys to Cloudflare. |
| Include SDK/CLI in one reference | Adopted | Most code changes need only route/client/command lookup, not separate deep references. |
| Move GitHub channel guidance to `channel-github.md` | Adopted | User requested flat provider-specific references listed directly in `SKILL.md`. |
| Add Sentry guidance to `observability-sentry.md` | Adopted | Sentry has target-specific setup and repo-specific wrapping conventions that are too detailed for `persistence-observability.md`. |
| Keep Slack, OpenTelemetry, and Braintrust as source evidence for now | Adopted | They clarify patterns and comparison boundaries, but the current runtime lookup need is GitHub and Sentry. |
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
| GitHub channel ingress and tools | Covered | `references/channel-github.md`, `references/troubleshooting.md` |
| Sentry setup and data boundaries | Covered | `references/observability-sentry.md`, `references/troubleshooting.md` |
| Local repo conventions | Covered | `SKILL.md`, all relevant references |

## Source Adaptation Notes

- Source intent: official docs teach Flue concepts, APIs, and deployment paths.
- Local target behavior: make coding agents produce repo-compatible Flue changes quickly and safely.
- Fidelity boundary: preserve behavior contracts, source-root discovery order, transport exposure rules, Cloudflare migration rules, and security boundaries.
- Local replacements: docs use source-root wording; this repo's source root is `src/`, so references use `src/...` paths for local additions.
- Omitted material: full prose, long code walkthroughs, non-Cloudflare deploy recipes beyond summary, and exhaustive SDK/WebSocket type tables.
- Rights and attribution: no long verbatim docs copied; source URLs retained here for attribution and refresh.

## Trigger Optimization

Should trigger:
- "Add a new Flue workflow and deploy it to Cloudflare."
- "Why is my Flue agent not discovered?"
- "Wire a Cloudflare Sandbox into this createAgent."
- "Expose this Flue workflow over HTTP."
- "Add a GitHub channel to this Flue app."
- "Fix a Flue GitHub webhook handler that cannot read issue comments."
- "Add Sentry reporting to this Flue Cloudflare app."
- "Wrap this Flue workflow Durable Object with Sentry."
- "Use @flue/runtime to add a tool and structured result."
- "Fix the wrangler migrations for a new Flue agent."

Should not trigger:
- "Write a generic Cloudflare Worker with no Flue."
- "Create an Agent Skill for a non-Flue repo."
- "Compare LLM providers generally."
- "Debug a Hono app that does not use Flue."
- "Handle GitHub webhooks in a non-Flue service."
- "Set up Sentry in an Express app with no Flue."
- "Explain Cloudflare pricing."

Final description was tuned to include Flue-specific nouns, ecosystem channels, Sentry observability, Cloudflare deployment, and concrete APIs while excluding generic Cloudflare, GitHub, Sentry, or AI SDK language.

## Gaps

| Gap | Impact | Next retrieval action |
| --- | --- | --- |
| Several official Flue pages are marked AI-generated awaiting review | Medium for exact edge behavior | Re-check upstream docs and changelog before high-risk production changes. |
| No Flue changelog deep synthesis beyond docs links | Medium for version drift | Fetch upstream changelog when package versions change. |
| Cloudflare platform docs not independently synthesized | Medium for Wrangler/container changes | Check official Cloudflare docs before migration, container, or Workers AI changes. |
| Slack, OpenTelemetry, and Braintrust do not yet have runtime reference files | Low until requested | Add `channel-slack.md`, `observability-opentelemetry.md`, or `observability-braintrust.md` when a task requires those integrations. |
| No real holdout run using this skill yet | Low | Use on the next Flue code change and record any misses. |

## Retrieval Stop Rationale

Collected all docs pages linked from the official docs navigation and fetched their Markdown forms, plus local repo convention files and current implementation examples. Further retrieval is likely to repeat known docs unless a task needs current Cloudflare or Flue changelog verification.
