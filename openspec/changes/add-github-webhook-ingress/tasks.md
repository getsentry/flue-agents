## 1. Route Security

- [x] 1.1 Add `FLUE_HTTP_TOKEN` to environment typing and local/example secret documentation.
- [x] 1.2 Update `src/app.ts` so `/workflows/*`, `/agents/*`, `/runs/*`, and `/openapi.json` require valid internal authorization.
- [x] 1.3 Preserve unauthenticated `GET` and `HEAD` handling for `/robots.txt`.
- [x] 1.4 Add tests proving direct Flue workflow, agent, run, and OpenAPI routes reject unauthenticated requests.
- [x] 1.5 Add tests proving valid internal authorization allows protected Flue routes to reach Flue routing.

## 2. GitHub Webhook Ingress

- [x] 2.1 Add `GITHUB_WEBHOOK_SECRET` to environment typing and local/example secret documentation.
- [x] 2.2 Implement `POST /channels/github/webhook` in `src/app.ts` before generic Flue routing.
- [x] 2.3 Verify `X-Hub-Signature-256` against the raw request body with `@flue/github` and `GITHUB_WEBHOOK_SECRET` before JSON parsing.
- [x] 2.4 Validate webhook event headers and payload shape for `issues.opened` events.
- [x] 2.5 Reject webhook payloads from unexpected GitHub App installation ids.
- [x] 2.6 Ignore unsupported GitHub events, unsupported issue actions, and pull request issue payloads without admitting workflow runs.
- [x] 2.7 Internally invoke `issue-triage` in non-blocking workflow mode with repository and issue number from the verified webhook payload.

## 3. Documentation And Setup

- [x] 3.1 Document the GitHub App webhook URL as `/channels/github/webhook`.
- [x] 3.2 Document GitHub App webhook settings: content type `application/json`, webhook secret, and Issues event subscription.
- [x] 3.3 Document that repository scope is controlled by installing the GitHub App only on selected repositories for this change.
- [x] 3.4 Document manual/operator workflow invocation with the internal Flue HTTP token.
- [x] 3.5 Add Wrangler secret setup instructions for `GITHUB_WEBHOOK_SECRET` and `FLUE_HTTP_TOKEN`.

## 4. Validation And Deployment

- [x] 4.1 Run `pnpm run test`.
- [x] 4.2 Run `pnpm run typecheck`.
- [x] 4.3 Run `pnpm run build`.
- [x] 4.4 Set Cloudflare production secrets for `GITHUB_WEBHOOK_SECRET` and `FLUE_HTTP_TOKEN`.
- [x] 4.5 Deploy with `pnpm run deploy`.
- [x] 4.6 Verify unauthenticated direct workflow invocation is rejected on the deployed Worker.
- [ ] 4.7 Verify a signed GitHub webhook delivery is accepted and starts a Flue run.
- [x] 4.8 Configure documentation for Cloudflare Workers Builds deployment from `main`.
