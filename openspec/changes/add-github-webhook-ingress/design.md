## Context

The current Cloudflare deployment exposes Flue's generated HTTP routes at the Worker root. The `issue-triage` workflow is intentionally the bounded triage entry point, but a public `POST /workflows/issue-triage` route is not the correct production interface for a GitHub App because it has no GitHub request authentication, no event filtering, and no webhook response timing boundary.

Flue's routing guidance is to add `src/app.ts` when an application needs custom ingress such as webhooks or authentication. The authored app should verify the external request, normalize it, and then deliver work to the appropriate Flue workflow or agent. This keeps provider-specific security outside the workflow's business logic while still using Flue for durable execution.

## Goals / Non-Goals

**Goals:**

- Provide a GitHub App webhook URL for issue triage.
- Verify GitHub webhook signatures before parsing or acting on payloads.
- Admit only explicitly supported GitHub issue events, initially `issues.opened`.
- Keep direct Flue workflow, agent, run, and OpenAPI routes protected from unauthenticated internet callers.
- Preserve the existing `issue-triage` workflow behavior after work is admitted.
- Rely on GitHub App installation repository selection for initial repository scoping.

**Non-Goals:**

- Do not add in-repository `.github/flue-agents.yml` configuration in this change.
- Do not subscribe to every GitHub event or implement broad event routing.
- Do not add a UI or operator dashboard.
- Do not change the triage diagnosis, duplicate handling, spam handling, or GitHub mutation logic.
- Do not expose the underlying `issue-triage` agent as a direct prompt route.

## Decisions

### Use an application-owned webhook route

Add `POST /channels/github/webhook` in `src/app.ts` instead of pointing GitHub at a Flue workflow route. Keep `/github/webhook` as a compatibility alias during setup, but document the Flue channel URL.

Rationale: GitHub webhooks require raw-body signature verification, provider-specific event headers, and fast admission responses. Flue workflows should receive trusted normalized payloads, not raw GitHub webhook requests.

Alternative considered: Configure GitHub to call `/workflows/issue-triage` directly. This was rejected because it would require putting GitHub authentication inside the workflow transport path and would expose a mutation-capable workflow endpoint to non-GitHub callers unless separately protected.

### Verify `X-Hub-Signature-256` with `@flue/github`

The webhook handler must mount Flue's GitHub channel package and configure it with `GITHUB_WEBHOOK_SECRET`. The package verifies `X-Hub-Signature-256` against the exact raw request bytes before JSON parsing, rejects non-JSON deliveries, and acknowledges GitHub `ping` internally.

Rationale: This is GitHub's standard webhook authentication mechanism and proves that the request body was delivered by GitHub with the shared secret configured on the GitHub App.

Alternative considered: Trust source IPs or GitHub headers. This was rejected because source ranges change and headers are forgeable without signature verification.

### Fail closed for direct Flue routes

Protect `/workflows/*`, `/agents/*`, `/runs/*`, and `/openapi.json` with `Authorization: Bearer <FLUE_HTTP_TOKEN>`. If the token is absent, those routes remain unavailable to external callers.

Rationale: The workflow can mutate GitHub issues and run routes can expose payloads, results, and model activity. Public access is not acceptable for production.

Alternative considered: Remove the workflow `route` export. This would close direct HTTP access, but it also removes a useful controlled manual/operator path and complicates internal admission through Flue's standard workflow transport.

### Admit webhook work without waiting for result

The webhook handler should invoke `issue-triage` in non-blocking workflow mode and return GitHub a `202` response after Flue accepts the run.

Rationale: GitHub webhook delivery has timeout and retry behavior; triage may take longer than a webhook response window. The durable Flue run is the correct boundary for long-running work.

Alternative considered: Use `?wait=result`. This was rejected for webhook delivery because it couples GitHub's request lifecycle to model/tool execution latency.

### Use GitHub App installation scope for initial repo selection

For this change, repositories are eligible only if the GitHub App is installed on them and GitHub sends the supported event. In-repository opt-in configuration is deferred.

Rationale: The user wants selected repos, and GitHub App installation repository selection is the first correct security boundary. Repo-local config can be layered later as product policy, but it should not be necessary for the first secure webhook setup.

Alternative considered: Implement `.github/flue-agents.yml` immediately. This was deferred to keep the first change focused on authenticated ingress and Flue route security.

## Risks / Trade-offs

- Misconfigured `GITHUB_WEBHOOK_SECRET` -> GitHub deliveries receive 401/503 and no triage runs occur. Mitigation: document setup and add tests for missing and invalid secret behavior.
- GitHub App installed on too many repositories -> supported issue events can trigger triage for those repositories. Mitigation: document "Only select repositories" installation and restrict accepted events to `issues.opened`.
- Public manual workflow invocation blocked by default -> local/operator testing needs `FLUE_HTTP_TOKEN`. Mitigation: document token-based manual invocation and keep the webhook path independent of that token.
- Webhook retries after transient admission failures -> duplicate triage runs may be possible. Mitigation: keep initial implementation simple, then add delivery-id deduplication if repeated deliveries become an observed issue.
- Run inspection remains sensitive -> `/runs/*` requires the same internal token. Mitigation: add tests that run routes are unauthorized without a token.

## Migration Plan

1. Implement webhook route and Flue route authorization in `src/app.ts`.
2. Add `GITHUB_WEBHOOK_SECRET` and `FLUE_HTTP_TOKEN` to `.env.example`, `.env.local` setup docs, and Cloudflare production secrets.
3. Deploy the Worker.
4. Configure the GitHub App webhook URL to `https://sentry-flue-agents.getsentry.workers.dev/channels/github/webhook`.
5. Subscribe the GitHub App to Issues events only.
6. Install or configure the app for selected repositories only.
7. Test delivery with a GitHub redelivery or a controlled new issue in an installed repository.

Rollback: remove or deactivate the webhook URL in the GitHub App settings, then deploy the prior Worker version if needed. With webhooks disabled, no new automatic triage runs will be admitted.

## Open Questions

- Do we need delivery-id deduplication in the first implementation, or is it acceptable as a follow-up after observing GitHub retries?
- Should unsupported issue actions return `202` with an ignored reason or `204 No Content`?
