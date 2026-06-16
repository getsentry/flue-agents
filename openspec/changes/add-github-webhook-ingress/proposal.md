## Why

GitHub issue triage is currently exposed as a directly callable Flue workflow, which is useful for manual testing but not the right production ingress for a GitHub App. We need a GitHub App webhook entry point that authenticates GitHub-delivered events, gates what work is admitted, and keeps mutation-capable Flue routes from being publicly invocable.

## What Changes

- Add a GitHub App webhook route owned by `src/app.ts`, intended for the GitHub App webhook URL.
- Verify GitHub webhook signatures with Flue's GitHub channel package using a new `GITHUB_WEBHOOK_SECRET` secret before acting on payloads.
- Accept only supported GitHub issue events, initially `issues.opened`, and ignore unsupported events without running triage.
- Invoke the existing `issue-triage` Flue workflow internally after webhook authentication and event validation.
- Protect public Flue routes (`/workflows/*`, `/agents/*`, `/runs/*`, and public API metadata) behind an operator/internal token instead of leaving mutation and run-inspection routes open to the internet.
- Defer in-repository opt-in/configuration to a later change; repository scope is controlled by the GitHub App installation and event/action allowlist for this change.

## Capabilities

### New Capabilities

- `github-webhook-ingress`: Authenticated GitHub App webhook ingress for admitting issue triage work into Flue.

### Modified Capabilities

- `issue-triage`: Issue triage is still performed by the existing workflow, but production admission must be through verified GitHub webhook ingress or an explicitly authorized internal/manual route.

## Impact

- `src/app.ts`: custom HTTP routing for `/channels/github/webhook`, route-level authorization for Flue public routes, and `robots.txt`.
- `src/workflows/issue-triage.ts`: may remain the bounded workflow entry point, but direct HTTP access must require internal authorization.
- Cloudflare secrets: add `GITHUB_WEBHOOK_SECRET`; add `FLUE_HTTP_TOKEN` or equivalent internal route token for manual/operator workflow access.
- GitHub App configuration: set webhook URL to `/channels/github/webhook`, set webhook secret, subscribe to Issues events, and keep app installation scoped to selected repositories.
- Tests: add webhook signature, event allowlist, direct route authorization, and internal workflow invocation coverage.
- Documentation: update setup/deployment instructions for GitHub App webhook configuration and manual invocation auth.
