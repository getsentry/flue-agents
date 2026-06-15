# Agent Instructions

## Package Manager
- Use **pnpm**: `pnpm install`

## Source Layout
- This is a root-layout Flue project; keep discovered modules in root `agents/`, `workflows/`, `app.ts`, or `cloudflare.ts`.
- Do not add `.flue/` or `src/` source layouts unless the whole repo is migrated; Flue only discovers the first existing source directory.
- Keep discovered agent and workflow files flat and lower-kebab-case.

## Commands
| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Typecheck | `pnpm run typecheck` |
| Cloudflare dev | `pnpm run dev` |
| Cloudflare build | `pnpm run build` |
| Deploy | `pnpm run deploy` |

## Key Conventions
- Cloudflare Worker config lives in `wrangler.jsonc`.
- Cloudflare-only exports live in root `cloudflare.ts`.
- Packaged Flue skills live in `skills/<name>/` and are imported by agent modules.
- Runtime secrets belong in `.env` locally or Wrangler secrets in production; never commit tokens.
- GitHub issue triage requires `GH_TOKEN` or `GITHUB_TOKEN`.
- When adding agents or workflows, update `README.md` and append matching Durable Object migrations in `wrangler.jsonc`.

## External References
| Need | File |
|------|------|
| Setup and operations | `README.md` |
| Migrated triage behavior | `skills/issue-triage/SKILL.md` |
| Regression fixture | `fixtures/issue-triage/external-registry-spam-1059.json` |

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: (the agent's name and attribution byline)
```
