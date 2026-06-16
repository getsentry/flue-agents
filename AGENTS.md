# Agent Instructions

## Package Manager
- Use **pnpm**: `pnpm install`

## Source Layout
- Keep Flue modules in `src/agents/`, `src/workflows/`, `src/app.ts`, and `src/cloudflare.ts`.
- Keep Flue source layouts out of `.flue/` and the repository root.
- Keep discovered agent and workflow files flat and lower-kebab-case.

## Commands
| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Test | `pnpm run test` |
| Typecheck | `pnpm run typecheck` |
| Cloudflare dev | `pnpm run dev` |
| Cloudflare build | `pnpm run build` |
| Deploy | `pnpm run deploy` |

## Key Conventions
- Cloudflare Worker config lives in `wrangler.jsonc`.
- Top-level Cloudflare Worker exports live in `src/cloudflare.ts`; Flue module-local `cloudflare = extend({ wrap })` descriptors stay beside the owning agent or workflow.
- Packaged Flue skills live in `src/skills/<name>/` and are imported by agent modules.
- Runtime secrets belong in `.env.local` locally or Wrangler secrets in production; never commit tokens.
- GitHub issue triage requires GitHub App credentials: `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`.
- Sentry reporting uses `@sentry/cloudflare` through module-local Flue `cloudflare = extend({ wrap })` exports; keep shared Sentry option handling in `src/lib/sentry.ts`.
- When adding agents or workflows, update docs as needed and append matching Durable Object migrations in `wrangler.jsonc`.

## External References
| Need | File |
|------|------|
| Overview and quick start | `README.md` |
| Setup and development | `CONTRIBUTING.md` |
| Migrated triage behavior | `src/skills/issue-triage/SKILL.md` |
| Regression fixture | `fixtures/issue-triage/external-registry-spam-1059.json` |

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: (the agent's name and attribution byline)
```
